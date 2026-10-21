import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { ApiError } from "../errors/api.ts";
import { getTask } from "../domains/tasks/service.ts";
import { getRequest } from "../domains/requests/service.ts";
import {
  listRequestVisits,
  proposeVisit,
  updateVisit,
} from "../domains/tasks/visits.ts";
import { message, messageButton, safeBlock } from "../templates/message.ts";
import { type BotReply, btn } from "./keyboard.ts";
import { type BotInput, inputFormReply } from "./input-form.ts";
import { esc, fmtInterval } from "./text.ts";
import { parseVisitWhen } from "./visit-time.ts";

export const VISIT_COMMANDS = [
  "/visits",
  "/taskvisits",
  "/proposevisit",
  "/visitaction",
  "/visitconfirm",
];
/** The caller locks and saves its own bot channel in the same transaction. */
export async function visitFlow(
  deps: RegistryDeps,
  actor: Actor,
  state: Row,
  input: string,
  worker: boolean,
): Promise<BotReply | undefined> {
  const [command, id, choice, action] = input.trim().split(/\s+/);
  const lang = actor.profile.language;
  const label = (id: string) =>
    messageButton(deps.templates, lang, "bot.controls", id);
  let form = state.visit_form as BotInput | undefined;
  if (form && !input.startsWith("/")) {
    if (form.index < form.fields.length) {
      if (!input.trim() || input.length > 10000) {
        throw new ApiError("VALIDATION_FAILED");
      }
      if (form.fields[form.index] === "date" && !parseVisitWhen(input)) {
        return inputFormReply(form, lang, deps.templates);
      }
      form.values.push(input.trim());
      form.index++;
    }
    return inputFormReply(form, lang, deps.templates);
  }
  if (command === "/visitconfirm") {
    if (!form || id !== form.token || form.index !== form.fields.length) {
      throw new ApiError("VALIDATION_FAILED");
    }
    if (form.command === "/proposevisit") {
      const interval = parseVisitWhen(form.values[0]!);
      if (!interval) throw new ApiError("VALIDATION_FAILED");
      await proposeVisit(deps, actor, {
        task_id: form.object_id,
        expected_version: form.version,
        interval_start: interval.start,
        interval_end: interval.end,
        note: form.values[1],
      }, `visit:${form.token}`);
    } else {
      const extra = form.command === "no_access"
        ? {
          contact_attempts: form.values[1],
          occurred_at: parseVisitWhen(form.values[2]!)?.start,
        }
        : {};
      await updateVisit(deps, actor, form.object_id, {
        action: form.command,
        version: form.version,
        reason: form.values[0],
        ...extra,
      }, `visit:${form.token}`);
    }
    delete state.visit_form;
    return {
      text: message(deps.templates, lang, "bot.saved"),
      buttons: [[btn(label("back"), form.cancel_command)]],
    };
  }
  if (command === "/proposevisit") {
    if (!worker) throw new ApiError("FORBIDDEN");
    const [found] = await deps.db.query<Row>(
      "select id from task where number=$1 or id::text=lower($1)",
      [id ?? ""],
    );
    if (!found) throw new ApiError("NOT_FOUND");
    const task = await getTask(deps, actor, String(found.id));
    if (!task.can_execute && !task.can_manage) throw new ApiError("FORBIDDEN");
    form = {
      token: crypto.randomUUID(),
      command,
      object_id: String(task.id),
      number: String(task.number),
      version: Number(task.version),
      title: label("proposevisit"),
      fields: ["date", "text"],
      values: [],
      index: 0,
      confirm_command: "/visitconfirm",
      cancel_command: `/task ${task.number}`,
    };
    state.visit_form = form;
    return inputFormReply(form, lang, deps.templates);
  }
  if (command === "/visitaction") {
    const context = state.visit_context as Row | undefined;
    const visit = (context?.items as Row[] | undefined)?.[Number(choice)];
    if (
      !context || id !== context.token || !visit ||
      !["confirm", "no_show", "no_access"].includes(action ?? "")
    ) throw new ApiError("VALIDATION_FAILED");
    // Domain rechecks the current actor, parent, interval, state and version.
    form = {
      token: crypto.randomUUID(),
      command: action!,
      object_id: String(visit.id),
      number: String(context.number),
      version: Number(visit.version),
      title: label(action!),
      fields: action === "confirm"
        ? []
        : action === "no_access"
        ? ["reason", "contact", "date"]
        : ["reason"],
      values: [],
      index: 0,
      confirm_command: "/visitconfirm",
      cancel_command: String(context.back),
    };
    state.visit_form = form;
    return inputFormReply(form, lang, deps.templates);
  }
  if (command !== "/visits" && command !== "/taskvisits") {
    if (command?.startsWith("/")) {
      delete state.visit_form;
      delete state.visit_context;
    }
    return undefined;
  }
  delete state.visit_form;
  const taskMode = command === "/taskvisits";
  const [found] = await deps.db.query<Row>(
    `select id from ${
      taskMode ? "task" : "request"
    } where number=$1 or id::text=lower($1)`,
    [id ?? ""],
  );
  if (!found) throw new ApiError("NOT_FOUND");
  const object = taskMode
    ? await getTask(deps, actor, String(found.id))
    : await getRequest(deps, actor, String(found.id));
  const visits =
    (taskMode
      ? object.visits
      : await listRequestVisits(deps, actor, String(object.id))) as Row[];
  const back = `/${taskMode ? "task" : "request"} ${object.number}`;
  const token = crypto.randomUUID().slice(0, 12);
  state.visit_context = { token, items: visits, number: object.number, back };
  const statuses: Record<string, [string, string]> = {
    proposed: ["Предложен", "Ұсынылған"],
    confirmed: ["Согласован", "Келісілген"],
    rescheduled: ["Перенесён", "Ауыстырылған"],
  };
  return {
    text: message(deps.templates, lang, "bot.visits", {
      items: safeBlock(
        visits.map((v, i) =>
          `${i + 1}. ${esc(fmtInterval(v.interval_start, v.interval_end))} · ${
            esc(statuses[String(v.status)]?.[lang === "kk" ? 1 : 0] ?? v.status)
          }`
        ).join("\n") || "—",
      ),
    }),
    buttons: [
      ...visits.flatMap((v, i) => {
        const available = worker
          ? (v.status === "confirmed" ? ["no_access"] : [])
          : object.can_act_as_author || object.can_comment
          ? (v.status === "proposed"
            ? ["confirm"]
            : v.status === "confirmed"
            ? ["no_show"]
            : [])
          : [];
        return available.map(
          (a) => [
            btn(`${i + 1}. ${label(a)}`, `/visitaction ${token} ${i} ${a}`),
          ],
        );
      }),
      ...(taskMode
        ? [[btn(label("proposevisit"), `/proposevisit ${object.number}`)]]
        : []),
      [btn(label("back"), back)],
    ],
  };
}
