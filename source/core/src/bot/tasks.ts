import { reportProblem } from "../domains/tasks/problems.ts";
import { proposeVisit, updateVisit } from "../domains/tasks/visits.ts";
import { taskActions, workerHelp } from "./help.ts";
import { cmd, esc, fmtDate, fmtInterval, numbered } from "./text.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { jsonValue, type Row } from "../domains/registry/validation.ts";
import { ApiError } from "../errors/api.ts";
import { actorForTelegram, registrationStep } from "./registration.ts";
import {
  getTask,
  listTasks,
  transitionTask,
} from "../domains/tasks/service.ts";
import { submitTaskReport } from "../domains/tasks/reports.ts";
import { TASK_STATE_TEXT } from "../locales/tasks.ts";
export const TASK_COMMANDS = [
  "/pausetask",
  "/problem",
  "/proposevisit",
  "/noaccess",
  "/tasks",
  "/task",
  "/accepttask",
  "/declinetask",
  "/starttask",
  "/reporttask",
  "/taskfiles",
  "/submitreport",
];
const HELP = workerHelp();
export async function taskStep(
  deps: RegistryDeps,
  telegramId: string,
  input: string,
  providedActor?: Actor,
  operationId?: string,
): Promise<string> {
  return deps.db.transaction(async (exec) => {
    const d = {
      ...deps,
      db: {
        ...deps.db,
        query: exec.query.bind(exec),
        transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
      },
    };
    const actor = providedActor ?? await actorForTelegram(d, telegramId);
    if (!actor) throw new ApiError("FORBIDDEN");
    await exec.query(
      "insert into bot_dialog(telegram_user_id,profile_id) values ($1,$2) on conflict do nothing",
      [telegramId, actor.profile.id],
    );
    const [dialog] = await exec.query(
      "select state from bot_dialog where telegram_user_id=$1 for update",
      [telegramId],
    );
    const state = jsonValue<Row>(dialog!.state);
    const save = async (text: string) => {
      state.scenario = "tasks";
      await exec.query(
        "update bot_dialog set state=$2::text::jsonb,updated_at=now() where telegram_user_id=$1",
        [telegramId, JSON.stringify(state)],
      );
      return text;
    };
    const [command, number, ...args] = input.trim().split(/\s+/);
    const key = operationId ?? crypto.randomUUID();
    const find = async () => {
      const [t] = await exec.query<{ id: string }>(
        "select id from task where number=$1",
        [number],
      );
      if (!t) throw new ApiError("NOT_FOUND");
      return getTask(d, actor, t.id);
    };
    if (command === "/registration") {
      await exec.query(
        "update bot_dialog set state='{}'::jsonb where telegram_user_id=$1",
        [telegramId],
      );
      return registrationStep(d, telegramId, "/registration");
    }
    if (command === "/tasks") {
      const tasks = await listTasks(d, actor);
      delete state.task_id;
      delete state.report;
      const lines = tasks.slice(0, 30).map((t) =>
        `<b>${esc(t.number)}</b> — ${esc(String(t.title).slice(0, 100))} — ${
          esc(TASK_STATE_TEXT[t.state] ?? String(t.state))
        }`
      );
      return save(
        (lines.length ? numbered(lines) : "Заданий нет / Тапсырма жоқ") +
        `\n${cmd("/task НОМЕР")} — открыть задание / тапсырманы ашу`,
      );
    }
    if (command === "/task") {
      const t = await find();
      state.task_id = t.id;
      delete state.report;
      const visits = ((t.visits as Row[]) ?? []).map((v) =>
        `Визит: ${fmtInterval(v.interval_start, v.interval_end)} — ${esc(String(v.status))}`
      );
      const actions = taskActions(t.state);
      return save(
        [
          `<b>${esc(t.number)}</b> — ${esc(t.title)}`,
          esc(TASK_STATE_TEXT[String(t.state)] ?? String(t.state)),
          esc(t.instruction),
          t.methodology
            ? `Методичка: версия ${(t.methodology as Row).version}, ${esc(String((t.methodology as Row).author_name))}, ${fmtDate((t.methodology as Row).created_at)}`
            : "",
          visits.join("\n"),
          `Срок / Мерзім: ${fmtDate(t.due_at)} (Алматы)`,
          actions,
        ].filter(Boolean).join("\n"),
      );
    }
    const action = ({
      "/accepttask": "accept",
      "/declinetask": "decline",
      "/starttask": "start",
      "/pausetask": "request_pause",
    } as Record<string, string>)[command ?? ""];
    if (action) {
      const t = await find();
      const changed = await transitionTask(d, actor, String(t.id), {
        action,
        version: t.version,
        ...(["decline", "request_pause"].includes(action)
          ? { reason: args.join(" ") }
          : {}),
      }, key);
      state.task_id = t.id;
      delete state.report;
      return save(`${esc(changed.number)} — ${esc(TASK_STATE_TEXT[changed.state] ?? changed.state)}${taskActions(changed.state) ? `\n${taskActions(changed.state)}` : ""}`);
    }
    if (command === "/reporttask") {
      const t = await find();
      if (!t.can_execute || t.state !== "in_progress") {
        throw new ApiError("INVALID_TRANSITION");
      }
      state.task_id = t.id;
      state.report = {
        version: t.version,
        evidence: [],
        step: "performed_work",
      };
      return save(
        "Опишите выполненный объём. / Орындалған жұмысты сипаттаңыз.",
      );
    }
    if (command === "/problem") {
      const t = await find();
      const [location, description, numbers] = args.join(" ").split("|").map(
        (x) => x.trim(),
      );
      const files = (t.pending_files as Row[]) ?? [];
      const ids = (numbers ?? "").split(",").map((n) =>
        files[Number(n.trim()) - 1]?.id
      );
      await reportProblem(d, actor, String(t.id), {
        location,
        description,
        attachment_ids: ids,
      }, key);
      state.task_id = t.id;
      delete state.report;
      return save(
        "Найденная проблема передана администратору для создания или связывания задания.",
      );
    }
    if (command === "/proposevisit") {
      const t = await find();
      const [start, end, note] = args.join(" ").split("|").map((s) => s.trim());
      await proposeVisit(d, actor, {
        task_id: t.id,
        interval_start: start,
        interval_end: end,
        note,
      }, key);
      return save(
        "Интервал предложен жителю. Визит состоится только после согласования.",
      );
    }
    if (command === "/noaccess") {
      if (typeof state.task_id !== "string") {
        throw new ApiError("VALIDATION_FAILED", "Сначала откройте /task НОМЕР");
      }
      const t = await getTask(d, actor, state.task_id);
      const visit = ((t.visits as Row[]) ?? [])[Number(number) - 1];
      if (!visit) throw new ApiError("VALIDATION_FAILED", "Визит не найден");
      const [reason, attempts] = args.join(" ").split("|").map((s) => s.trim());
      await updateVisit(d, actor, String(visit.id), {
        action: "no_access",
        version: visit.version,
        reason,
        contact_attempts: attempts,
        occurred_at: new Date().toISOString(),
      }, key);
      return save(
        "Отсутствие доступа зафиксировано. Администратор и житель уведомлены.",
      );
    }
    const report = state.report as Row | undefined;
    const current = async () => {
      if (typeof state.task_id !== "string") {
        throw new ApiError("VALIDATION_FAILED", "Сначала откройте задание");
      }
      return getTask(d, actor, state.task_id);
    };
    const filesText = (t: Row) =>
      numbered(((t.pending_files as Row[]) ?? []).map((f) =>
        `${esc(f.filename)}: ${
          f.status === "complete" ? "сохранён / сақталды" : "ещё в очереди / кезекте"
        }`
      )) || "Файлов пока нет / Файл әзірше жоқ";
    if (command === "/taskfiles") return save(filesText(await current()));
    if (command === "/submitreport") {
      if (!report || report.step !== "ready") {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Заполните отчёт: /reporttask НОМЕР",
        );
      }
      const t = await current();
      const changed = await submitTaskReport(
        d,
        actor,
        String(t.id),
        report,
        key,
      );
      delete state.report;
      return save(`${esc(changed.number)} — ${esc(TASK_STATE_TEXT[changed.state] ?? changed.state)}`);
    }
    if (report && !input.startsWith("/")) {
      const t = await current();
      if (!t.can_execute || t.state !== "in_progress") {
        throw new ApiError("FORBIDDEN");
      }
      const requirements =
        (t.required_evidence as { id: string; required: boolean }[]) ?? [];
      if (report.step === "performed_work") {
        report.performed_work = input;
        report.step = "performed_at";
        return save(
          "Время выполнения: ГГГГ-ММ-ДД ЧЧ:ММ (Алматы). Например 2026-10-17 15:30.",
        );
      }
      if (report.step === "performed_at") {
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input)) {
          return save("Введите время в формате ГГГГ-ММ-ДД ЧЧ:ММ");
        }
        report.performed_at = input.replace(" ", "T") + ":00+05:00";
        report.step = "result";
        return save("Опишите результат.");
      }
      if (report.step === "result") {
        report.result = input;
        report.step = "limitations";
        return save("Оставшиеся ограничения? Напишите «нет», если их нет.");
      }
      if (report.step === "limitations") {
        report.limitations = input.toLowerCase() === "нет" ? "" : input;
        report.step = requirements.length ? "evidence" : "ready";
        report.index = 0;
      } else if (report.step === "evidence") {
        const index = Number(report.index), requirement = requirements[index]!;
        const files = (t.pending_files as Row[]) ?? [];
        const ids: number[] = input.split(",").map((v) => Number(v.trim()) - 1);
        const entry: Row = {
          requirement_id: requirement.id,
          attachment_ids: [],
        };
        if (input.startsWith("нет ")) entry.missing_reason = input.slice(4);
        else {
          if (
            !ids.length || ids.some((i) =>
              !Number.isInteger(i) || !files[i] ||
              files[i]!.status !== "complete"
            )
          ) {
            return save(
              "Выберите номера сохранённых файлов через запятую или напишите «нет причина».\n" +
                filesText(t),
            );
          }
          entry.attachment_ids = ids.map((i) => files[i]!.id);
        }
        (report.evidence as Row[]).push(entry);
        report.index = index + 1;
        if (index + 1 >= requirements.length) report.step = "ready";
      }
      if (report.step === "evidence") {
        return save(
          `Доказательство ${Number(report.index) + 1} из ${requirements.length}. Отправьте файл, дождитесь сохранения (${cmd("/taskfiles")}), затем введите его номер. Если доказательства нет — ${cmd("нет причина")}.\n${
            filesText(t)
          }`,
        );
      }
      return save(`Отчёт подготовлен. ${cmd("/submitreport")} — отправить на проверку.`);
    }
    return save(HELP);
  });
}
