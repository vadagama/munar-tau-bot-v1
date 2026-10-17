import { esc, pick, type Lang } from "./text.ts";
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
async function incidentPlainStep(
  deps: RegistryDeps,
  telegramId: string,
  input: string,
  providedActor?: Actor,
  operationId?: string,
): Promise<string> {
  const [command, id, ...args] = input.trim().split(/\s+/),
    actor = providedActor ?? await actorForTelegram(deps, telegramId),
    key = operationId ?? crypto.randomUUID(),
    // UUID в callback_data не помещаются (лимит 64 байта), поэтому инциденты —
    // без кнопок, только один язык подачи.
    L: Lang = actor?.profile.language ?? "ru";
  if (command === "/emergency" && !args.length) {
    if (!id) {
      return pick(
        L,
        "Авария: /emergency КОД_ДОМА — аварийный телефон; /emergency НОМЕР_ОБРАЩЕНИЯ описание — сообщить об опасности. Сигнал не подтверждает выезд.",
        "Апат: /emergency ҮЙ КОДЫ — апаттық телефон; /emergency ӨТІНІШ НӨМІРІ сипаттама — қауіп туралы хабарлаңыз. Сигнал шығуды растамайды.",
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
    return `${
      contact.phone ?? pick(L, "Телефон ещё не настроен", "Телефон әлі бапталмаған")
    }\n${pick(L, contact.notice.ru, contact.notice.kk)}`;
  }
  if (!actor) {
    throw new ApiError(
      "FORBIDDEN",
      pick(L, "Подтвердите регистрацию", "Тіркелуді растаңыз"),
    );
  }
  if (command === "/incidents") {
    return (await listIncidents(deps, actor)).map((r) =>
      `${r.number}: ${r.title}`
    ).join("\n") || pick(L, "Нет доступных аварий", "Қолжетімді апаттар жоқ");
  }
  if (command === "/incident") {
    const [r] = await deps.db.query<{ id: string }>(
      "select id from incident where number=$1",
      [id],
    );
    if (!r) throw new ApiError("NOT_FOUND");
    const card = await getIncident(deps, actor, r.id);
    return `${card.number}: ${card.title}\n${
      card.public_text ?? pick(L, "Сигнал проверяется", "Сигнал тексерілуде")
    }\n${card.forecast}`;
  }
  if (command === "/signals") {
    return (await listSignals(deps, actor)).map((s) =>
      `${s.id} • ${s.description}\n/acceptsignal ${s.id} ${s.version}`
    ).join("\n\n") || pick(L, "Нет сигналов", "Сигналдар жоқ");
  }
  if (command === "/acceptsignal" && id) {
    await acceptSignal(
      deps,
      actor,
      id,
      { expected_version: Number(args[0]) },
      key,
    );
    return pick(L, "Принято", "Қабылданды");
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
        throw new ApiError(
          "VALIDATION_FAILED",
          pick(L, "Дом не найден", "Үй табылмады"),
        );
      }
      r.building_id = building.id;
      description = parts.join("|").trim();
    }
    if (!r.building_id) {
      throw new ApiError(
        "VALIDATION_FAILED",
        pick(
          L,
          "/danger НОМЕР_ЗАДАНИЯ КОД_ДОМА | описание",
          "/danger ТАПСЫРМА НӨМІРІ ҮЙ КОДЫ | сипаттама",
        ),
      );
    }
    const signal = await signalEmergency(deps, actor, {
      [task ? "task_id" : "request_id"]: r.id,
      building_id: r.building_id,
      description,
    }, key);
    return `Сигнал: ${signal.id}\n${
      signal.contact.phone ?? ""
    }\n${pick(L, signal.contact.notice.ru, signal.contact.notice.kk)}`;
  }
  if (command === "/publications") {
    return (await listPublications(deps, actor)).filter((r) =>
      r.state === "published"
    ).map((r) => `${r.title}\n/publication ${r.id}`).join("\n\n") ||
      pick(L, "Нет публикаций", "Жарияланымдар жоқ");
  }
  if (command === "/publication" && id) {
    const p = await getPublication(deps, actor, id);
    return `${p.title}\n${p.body}${
      p.kind === "work_report"
        ? `\n${pick(
          L,
          `/workproblem ${id} КОД_ДОМА | описание`,
          `/workproblem ${id} ҮЙ КОДЫ | сипаттама`,
        )}`
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
    if (!b) {
      throw new ApiError(
        "VALIDATION_FAILED",
        pick(L, "Дом вне публикации", "Үй жарияланым аумағында емес"),
      );
    }
    const r = await publicationProblem(deps, actor, id, {
      source: "bot",
      building_id: b.building_id,
      text: text.join("|").trim(),
    }, key);
    return `${r.number}: ${pick(L, "зарегистрировано", "тіркелді")}`;
  }
  return pick(
    L,
    "/incidents — аварии; /publications — публикации; /emergency — опасность; /signals — сигналы",
    "/incidents — апаттар; /publications — жарияланымдар; /emergency — қауіп; /signals — сигналдар",
  );
}

/** Все ответы VS-7 — обычный текст; HTML разрешает только транспорт UX A. */
export async function incidentStep(
  ...args: Parameters<typeof incidentPlainStep>
): Promise<string> {
  return esc(await incidentPlainStep(...args));
}
