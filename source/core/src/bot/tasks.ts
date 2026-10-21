import { loadDialog, saveDialog } from "./dialog.ts";
import { BotTemplateError } from "./bot-errors.ts";
import { message, messageButton, safeBlock } from "../templates/message.ts";
import type { TemplateStore } from "../templates/store.ts";
import { reportProblem } from "../domains/tasks/problems.ts";
import { workerHelp } from "./help.ts";
import {
  esc,
  fmtDate,
  fmtDay,
  type Lang,
  numbered,
} from "./text.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { type Row } from "../domains/registry/validation.ts";
import { ApiError } from "../errors/api.ts";
import { actorForTelegram, registrationStep } from "./registration.ts";
import {
  getTask,
  listTasks,
  transitionTask,
} from "../domains/tasks/service.ts";
import { submitTaskReport } from "../domains/tasks/reports.ts";
import { TASK_STATE_TEXT } from "../locales/tasks.ts";
import { type BotReply, btn, type InlineButton } from "./keyboard.ts";
export const TASK_COMMANDS = [
  "/pausetask",
  "/problem",
  "/tasks",
  "/task",
  "/accepttask",
  "/declinetask",
  "/starttask",
  "/reporttask",
  "/taskfiles",
  "/submitreport",
];

/** Подпись состояния задания на языке профиля. */
const taskMessageKey = (base: string, state: unknown) =>
  [
      "awaiting_acceptance",
      "accepted",
      "in_progress",
      "suspended",
      "rework",
      "on_review",
    ].includes(String(state))
    ? `${base}.${state}`
    : base;

const stateLabel = (state: unknown, lang: Lang): string =>
  TASK_STATE_TEXT[String(state)]?.[lang] ?? String(state);

/** Кнопки карточки задания: ровно те же команды, что в подсказке «Действия». */
function taskButtons(
  t: Row,
  lang: Lang,
  store?: TemplateStore,
  key = "message.tasks.card",
): InlineButton[][] {
  if (!t.number) return [];
  const n = String(t.number);
  switch (String(t.state)) {
    case "awaiting_acceptance":
      return [[
        btn(messageButton(store, lang, key, "accept"), `/accepttask ${n}`),
      ]];
    case "accepted":
      return [[
        btn(messageButton(store, lang, key, "start"), `/starttask ${n}`),
      ]];
    case "suspended":
      return [[
        btn(messageButton(store, lang, key, "resume"), `/starttask ${n}`),
      ]];
    case "rework":
      return [[
        btn(messageButton(store, lang, key, "continue"), `/starttask ${n}`),
      ]];
    case "in_progress":
      return [[
        btn(messageButton(store, lang, key, "report"), `/reporttask ${n}`),
      ]];
    default:
      return [];
  }
}

export async function taskStep(
  deps: RegistryDeps,
  telegramId: string,
  input: string,
  providedActor?: Actor,
  operationId?: string,
): Promise<BotReply> {
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
    const L = actor.profile.language;
    const bot = deps.bot ?? "worker";
    const state = await loadDialog(exec, telegramId, bot, actor?.profile.id ?? null, actor?.emulation?.sessionId ?? null);
    const save = async (reply: BotReply) => {
      state.scenario = "tasks";
      await saveDialog(exec, telegramId, bot, state);
      return reply;
    };
    const [command, number, ...args] = input.trim().split(/\s+/);
    const key = operationId ?? crypto.randomUUID();
    const find = async () => {
      // Без номера postgres.js отклоняет undefined (UNDEFINED_VALUE) — апдейт
      // уходит в 500 и зацикливает повторную доставку (как в requests.ts).
      if (!number) {
        throw new BotTemplateError(
          "VALIDATION_FAILED",
          message(deps.templates, L, "tasks.ukazhite_nomer_zadaniya"),
        );
      }
      // Полный UUID принимается наравне с номером: глубокие ссылки
      // /start wrk_<uuid> (срез C) открывают карточку тем же кодом.
      const [t] = await exec.query<{ id: string }>(
        "select id from task where number=$1 or id::text=lower($1)",
        [number],
      );
      if (!t) throw new ApiError("NOT_FOUND");
      return getTask(d, actor, t.id);
    };
    if (command === "/registration") {
      await saveDialog(exec, telegramId, bot, {});
      return registrationStep(d, telegramId, "/registration");
    }
    if (command === "/tasks") {
      const tasks = await listTasks(d, actor);
      delete state.task_id;
      delete state.report;
      delete state.visit_when;
      const visible = tasks.slice(0, 30);
      const lines = visible.map((t) =>
        `<b>${esc(t.number)}</b> · ${esc(String(t.title).slice(0, 100))} · ${
          esc(stateLabel(t.state, L))
        }`
      );
      return save({
        text: message(
          deps.templates,
          L,
          lines.length ? "message.tasks.list" : "tasks.zadaniy_net",
          { tasks: safeBlock(numbered(lines)) },
        ),
        // Кнопка в строке списка открывает карточку тем же кодом, что /task НОМЕР.
        buttons: visible.map((t) => [
          btn(
            messageButton(deps.templates, L, "message.tasks.list", "open", {
              number: t.number,
              title: String(t.title).slice(0, 24),
            }),
            `/task ${t.number}`,
          ),
        ]),
      });
    }
    if (command === "/task") {
      const t = await find();
      state.task_id = t.id;
      delete state.report;
      delete state.visit_when;
      const cardKey = taskMessageKey(
        t.methodology ? "message.tasks.card_methodology" : "message.tasks.card",
        t.state,
      );
      return save({
        text: message(deps.templates, L, cardKey, {
          number: t.number,
          title: t.title,
          state: stateLabel(t.state, L),
          instruction: t.instruction,
          methodology_version: (t.methodology as Row | undefined)?.version,
          methodology_date: fmtDay(
            (t.methodology as Row | undefined)?.created_at,
          ),
          due_at: fmtDate(t.due_at),
        }),
        buttons: taskButtons(t, L, deps.templates, cardKey),
      });
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
      const changedKey = taskMessageKey("message.tasks.changed", changed.state);
      return save({
        text: message(deps.templates, L, changedKey, {
          number: changed.number,
          state: stateLabel(changed.state, L),
        }),
        buttons: taskButtons(changed, L, deps.templates, changedKey),
      });
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
        message(deps.templates, L, "tasks.opishite_vypolnennyy_obem"),
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
        message(
          deps.templates,
          L,
          "tasks.naydennaya_problema_peredana_administratoru_dlya_sozdaniya_ili",
        ),
      );
    }
    const report = state.report as Row | undefined;
    const current = async () => {
      if (typeof state.task_id !== "string") {
        throw new BotTemplateError(
          "VALIDATION_FAILED",
          message(deps.templates, L, "tasks.snachala_otkroyte_zadanie"),
        );
      }
      return getTask(d, actor, state.task_id);
    };
    const filesText = (t: Row) =>
      numbered(
        ((t.pending_files as Row[]) ?? []).map((f) =>
          `${esc(f.filename)}: ${
            f.status === "complete"
              ? message(deps.templates, L, "tasks.sohranen")
              : message(deps.templates, L, "tasks.esche_v_ocheredi")
          }`
        ),
      ) || message(deps.templates, L, "tasks.faylov_poka_net");
    if (command === "/taskfiles") {
      return save(
        message(deps.templates, L, "message.tasks.files", {
          files: safeBlock(filesText(await current())),
        }),
      );
    }
    if (command === "/submitreport") {
      if (!report || report.step !== "ready") {
        throw new BotTemplateError(
          "VALIDATION_FAILED",
          message(deps.templates, L, "tasks.zapolnite_otchet_reporttask_nomer"),
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
      return save({
        text: message(
          deps.templates,
          L,
          taskMessageKey("message.tasks.report_submitted", changed.state),
          { number: changed.number, state: stateLabel(changed.state, L) },
        ),
        buttons: taskButtons(
          changed,
          L,
          deps.templates,
          taskMessageKey("message.tasks.report_submitted", changed.state),
        ),
      });
    }
    if (report && !input.startsWith("/")) {
      const t = await current();
      if (!t.can_execute || t.state !== "in_progress") {
        throw new ApiError("FORBIDDEN");
      }
      const requirements =
        (t.required_evidence as { id: string; required: boolean }[]) ?? [];
      // «нет»/«жоқ» — оба по 4 символа с пробелом, причина срезается одинаково.
      const noPrefix = input.startsWith("нет ") || input.startsWith("жоқ ");
      const isNo = ["нет", "жоқ"].includes(input.toLowerCase());
      if (report.step === "performed_work") {
        report.performed_work = input;
        report.step = "performed_at";
        return save(
          message(
            deps.templates,
            L,
            "tasks.vremya_vypolneniya_gggg_mm_dd_chch_mm",
          ),
        );
      }
      if (report.step === "performed_at") {
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input)) {
          return save(
            message(
              deps.templates,
              L,
              "tasks.vvedite_vremya_v_formate_gggg_mm_dd",
            ),
          );
        }
        report.performed_at = input.replace(" ", "T") + ":00+05:00";
        report.step = "result";
        return save(message(deps.templates, L, "tasks.opishite_rezultat"));
      }
      if (report.step === "result") {
        report.result = input;
        report.step = "limitations";
        return save(
          message(
            deps.templates,
            L,
            "tasks.ostavshiesya_ogranicheniya_napishite_net_esli_ih_net",
          ),
        );
      }
      if (report.step === "limitations") {
        report.limitations = isNo ? "" : input;
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
        if (noPrefix) entry.missing_reason = input.slice(4);
        else {
          if (
            !ids.length || ids.some((i) =>
              !Number.isInteger(i) || !files[i] ||
              files[i]!.status !== "complete"
            )
          ) {
            return save(
              message(deps.templates, L, "message.tasks.evidence_invalid", {
                files: safeBlock(filesText(t)),
              }),
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
          message(deps.templates, L, "message.tasks.evidence", {
            number_report_index_1: Number(report.index) + 1,
            requirements_length: requirements.length,
            files: safeBlock(filesText(t)),
          }),
        );
      }
      return save({
        text: message(
          deps.templates,
          L,
          "tasks.otchet_podgotovlen_submitreport_otpravit_na_proverku",
        ),
        buttons: [[
          btn(
            messageButton(
              deps.templates,
              L,
              "tasks.otchet_podgotovlen_submitreport_otpravit_na_proverku",
              "submit",
            ),
            "/submitreport",
          ),
        ]],
      });
    }
    return save(workerHelp(L, deps.templates));
  });
}
