import { reportProblem } from "../domains/tasks/problems.ts";
import { proposeVisit, updateVisit } from "../domains/tasks/visits.ts";
import { taskActions, workerHelp } from "./help.ts";
import { cmd, esc, fmtDate, fmtDay, fmtInterval, numbered, pick, type Lang } from "./text.ts";
import { visitStateText } from "../locales/tasks.ts";
import {
  almatyDay,
  bareDayOffset,
  parseVisitWhen,
  visitFromDayTime,
} from "./visit-time.ts";
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
import { btn, type BotReply, type InlineButton } from "./keyboard.ts";
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

/** Подпись состояния задания на языке профиля. */
const stateLabel = (state: unknown, lang: Lang): string =>
  TASK_STATE_TEXT[String(state)]?.[lang] ?? String(state);

/** Кнопки карточки задания: ровно те же команды, что в подсказке «Действия». */
function taskButtons(t: Row, lang: Lang): InlineButton[][] {
  if (!t.number) return [];
  const n = String(t.number);
  switch (String(t.state)) {
    case "awaiting_acceptance":
      return [[btn(pick(lang, "Принять", "Қабылдау"), `/accepttask ${n}`)]];
    case "accepted":
      return [[btn(pick(lang, "Начать работу", "Жұмысты бастау"), `/starttask ${n}`)]];
    case "suspended":
      return [[btn(pick(lang, "Возобновить", "Жалғастыру"), `/starttask ${n}`)]];
    case "rework":
      return [[btn(pick(lang, "Продолжить", "Жалғастыру"), `/starttask ${n}`)]];
    case "in_progress":
      return [[btn(pick(lang, "Заполнить отчёт", "Есеп толтыру"), `/reporttask ${n}`)]];
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
    await exec.query(
      "insert into bot_dialog(telegram_user_id,profile_id) values ($1,$2) on conflict do nothing",
      [telegramId, actor.profile.id],
    );
    const [dialog] = await exec.query(
      "select state from bot_dialog where telegram_user_id=$1 for update",
      [telegramId],
    );
    const state = jsonValue<Row>(dialog!.state);
    const save = async (reply: BotReply) => {
      state.scenario = "tasks";
      await exec.query(
        "update bot_dialog set state=$2::text::jsonb,updated_at=now() where telegram_user_id=$1",
        [telegramId, JSON.stringify(state)],
      );
      return reply;
    };
    const [command, number, ...args] = input.trim().split(/\s+/);
    const key = operationId ?? crypto.randomUUID();
    const find = async () => {
      // Без номера postgres.js отклоняет undefined (UNDEFINED_VALUE) — апдейт
      // уходит в 500 и зацикливает повторную доставку (как в requests.ts).
      if (!number) {
        throw new ApiError(
          "VALIDATION_FAILED",
          pick(L, "Укажите номер задания", "Тапсырма нөмірін көрсетіңіз"),
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
      delete state.visit_when;
      const visible = tasks.slice(0, 30);
      const lines = visible.map((t) =>
        `<b>${esc(t.number)}</b> · ${esc(String(t.title).slice(0, 100))} · ${
          esc(stateLabel(t.state, L))
        }`
      );
      return save({
        text: lines.length
          ? numbered(lines)
          : pick(L, "Заданий нет", "Тапсырма жоқ"),
        // Кнопка в строке списка открывает карточку тем же кодом, что /task НОМЕР.
        buttons: visible.map((t) => [
          btn(
            `${t.number} · ${String(t.title).slice(0, 24)}`,
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
      const visits = ((t.visits as Row[]) ?? []).map((v) =>
        `${pick(L, "Визит", "Сапар")}: ${fmtInterval(v.interval_start, v.interval_end)} — ${esc(visitStateText(v.status, L))}`
      );
      const actions = taskActions(t.state, L);
      return save({
        text: [
          `<b>${esc(t.number)}</b> — ${esc(t.title)}`,
          esc(stateLabel(t.state, L)),
          esc(t.instruction),
          t.methodology
            ? pick(
              L,
              `Методичка: версия ${(t.methodology as Row).version}, действует с ${fmtDay((t.methodology as Row).created_at)}`,
              `Әдістеме: нұсқа ${(t.methodology as Row).version}, ${fmtDay((t.methodology as Row).created_at)} бастап қолданылады`,
            )
            : "",
          visits.join("\n"),
          `${pick(L, "Срок", "Мерзім")}: ${fmtDate(t.due_at)}`,
          actions,
        ].filter(Boolean).join("\n"),
        buttons: taskButtons(t, L),
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
      const actions = taskActions(changed.state, L);
      return save({
        text: `${esc(changed.number)} — ${esc(stateLabel(changed.state, L))}${
          actions ? `\n${actions}` : ""
        }`,
        buttons: taskButtons(changed, L),
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
        pick(
          L,
          "Опишите выполненный объём.",
          "Орындалған жұмыстың көлемін сипаттаңыз.",
        ),
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
        pick(
          L,
          "Найденная проблема передана администратору для создания или связывания задания.",
          "Табылған мәселе әкімшіге жаңа тапсырма жасау немесе байланыстыру үшін берілді.",
        ),
      );
    }
    if (command === "/proposevisit") {
      const t = await find();
      if (!args.length) {
        // Диалог (срез UX C): день — кнопкой, время — следующим сообщением.
        return save({
          text: pick(
            L,
            "Когда предложите визит? Напишите одним сообщением, например: завтра 10:00-12:00",
            "Сапарды қашан ұсынасыз? Бір хабарламада жазыңыз, мысалы: ертең 10:00-12:00",
          ),
          buttons: [[
            btn(pick(L, "Сегодня", "Бүгін"), `/proposevisit ${t.number} сегодня`),
            btn(pick(L, "Завтра", "Ертең"), `/proposevisit ${t.number} завтра`),
          ]],
        });
      }
      const parts = args.join(" ").split("|").map((s) => s.trim());
      const isIsoWithTz = (v: string | undefined) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) &&
        /(Z|[+-]\d{2}:\d{2})$/.test(v);
      let interval: { start: string; end: string } | undefined;
      let note: string | undefined;
      if (isIsoWithTz(parts[0]) && isIsoWithTz(parts[1])) {
        // Прежний ввод пары ISO-дат с часовым поясом — совместимость с тестами.
        interval = { start: parts[0]!, end: parts[1]! };
        note = parts[2] || undefined;
      } else if (typeof parts[0] === "string" && bareDayOffset(parts[0]) !== null) {
        // День без времени: запоминаем день, время — следующим сообщением.
        // Активный черновик отчёта сбрасывается, как в других поддиалогах.
        delete state.report;
        state.visit_when = {
          task_id: t.id,
          day: almatyDay(bareDayOffset(parts[0])!, new Date()),
        };
        return save(
          pick(
            L,
            "Теперь укажите время одним сообщением, например 10:00-12:00",
            "Енді уақытты бір хабарламада жазыңыз, мысалы 10:00-12:00",
          ),
        );
      } else if (parts[0]) {
        interval = parseVisitWhen(parts[0], new Date()) ?? undefined;
        note = parts[1] || undefined;
      }
      if (!interval) {
        throw new ApiError(
          "VALIDATION_FAILED",
          pick(
            L,
            "Не понял, когда визит. Примеры: завтра 10:00-12:00, сегодня 18:00, 20.10 09:00-11:00",
            "Сапар уақытын түсінбедім. Мысалдар: ертең 10:00-12:00, бүгін 18:00, 20.10 09:00-11:00",
          ),
        );
      }
      await proposeVisit(d, actor, {
        task_id: t.id,
        interval_start: interval.start,
        interval_end: interval.end,
        note,
      }, key);
      return save(
        pick(
          L,
          `Интервал предложен: ${fmtInterval(interval.start, interval.end)}. Визит состоится только после согласования.`,
          `Аралық ұсынылды: ${fmtInterval(interval.start, interval.end)}. Сапар тек келісілгеннен кейін өтеді.`,
        ),
      );
    }
    if (command === "/noaccess") {
      if (typeof state.task_id !== "string") {
        throw new ApiError(
          "VALIDATION_FAILED",
          pick(L, "Сначала откройте /task НОМЕР", "Алдымен /task НОМІР ашыңыз"),
        );
      }
      const t = await getTask(d, actor, state.task_id);
      const visit = ((t.visits as Row[]) ?? [])[Number(number) - 1];
      if (!visit) {
        throw new ApiError(
          "VALIDATION_FAILED",
          pick(L, "Визит не найден", "Сапар табылмады"),
        );
      }
      const [reason, attempts] = args.join(" ").split("|").map((s) => s.trim());
      await updateVisit(d, actor, String(visit.id), {
        action: "no_access",
        version: visit.version,
        reason,
        contact_attempts: attempts,
        occurred_at: new Date().toISOString(),
      }, key);
      return save(
        pick(
          L,
          "Отсутствие доступа зафиксировано. Администратор и житель уведомлены.",
          "Қолжетімділік жоқ екені тіркелді. Әкімші мен тұрғын хабарланды.",
        ),
      );
    }
    // Шаг диалога визита (срез UX C): после кнопки «сегодня/завтра» жду
    // время одним сообщением («10:00», «10:00-12:00») на сохранённый день.
    const visitWhen = state.visit_when as Row | undefined;
    if (visitWhen && !input.startsWith("/")) {
      const interval = visitFromDayTime(String(visitWhen.day), input);
      if (!interval) {
        return save(
          pick(
            L,
            "Не понял время. Напишите одним сообщением, например 10:00-12:00",
            "Уақытты түсінбедім. Бір хабарламада жазыңыз, мысалы 10:00-12:00",
          ),
        );
      }
      await proposeVisit(d, actor, {
        task_id: String(visitWhen.task_id),
        interval_start: interval.start,
        interval_end: interval.end,
      }, key);
      delete state.visit_when;
      return save(
        pick(
          L,
          `Интервал предложен: ${fmtInterval(interval.start, interval.end)}. Визит состоится только после согласования.`,
          `Аралық ұсынылды: ${fmtInterval(interval.start, interval.end)}. Сапар тек келісілгеннен кейін өтеді.`,
        ),
      );
    }
    const report = state.report as Row | undefined;
    const current = async () => {
      if (typeof state.task_id !== "string") {
        throw new ApiError(
          "VALIDATION_FAILED",
          pick(L, "Сначала откройте задание", "Алдымен тапсырманы ашыңыз"),
        );
      }
      return getTask(d, actor, state.task_id);
    };
    const filesText = (t: Row) =>
      numbered(((t.pending_files as Row[]) ?? []).map((f) =>
        `${esc(f.filename)}: ${
          f.status === "complete"
            ? pick(L, "сохранён", "сақталды")
            : pick(L, "ещё в очереди", "кезекте")
        }`
      )) || pick(L, "Файлов пока нет", "Файл әзірше жоқ");
    if (command === "/taskfiles") return save(filesText(await current()));
    if (command === "/submitreport") {
      if (!report || report.step !== "ready") {
        throw new ApiError(
          "VALIDATION_FAILED",
          pick(
            L,
            "Заполните отчёт: /reporttask НОМЕР",
            "Есепті толтырыңыз: /reporttask НОМІР",
          ),
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
        text: `${esc(changed.number)} — ${esc(stateLabel(changed.state, L))}`,
        buttons: taskButtons(changed, L),
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
          pick(
            L,
            "Время выполнения: ГГГГ-ММ-ДД ЧЧ:ММ (Алматы). Например 2026-10-17 15:30.",
            "Орындалу уақыты: ЖЖЖЖ-АА-КК СС:ММ (Алматы). Мысалы 2026-10-17 15:30.",
          ),
        );
      }
      if (report.step === "performed_at") {
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input)) {
          return save(
            pick(
              L,
              "Введите время в формате ГГГГ-ММ-ДД ЧЧ:ММ",
              "Уақытты ЖЖЖЖ-АА-КК СС:ММ форматында енгізіңіз",
            ),
          );
        }
        report.performed_at = input.replace(" ", "T") + ":00+05:00";
        report.step = "result";
        return save(pick(L, "Опишите результат.", "Нәтижені сипаттаңыз."));
      }
      if (report.step === "result") {
        report.result = input;
        report.step = "limitations";
        return save(
          pick(
            L,
            "Оставшиеся ограничения? Напишите «нет», если их нет.",
            "Қалған шектеулер бар ма? Жоқ болса «жоқ» деп жазыңыз.",
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
              pick(
                L,
                "Выберите номера сохранённых файлов через запятую или напишите «нет причина».\n",
                "Сақталған файлдардың нөмірлерін үтірмен таңдаңыз немесе «жоқ себеп» деп жазыңыз.\n",
              ) + filesText(t),
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
          pick(
            L,
            `Доказательство ${Number(report.index) + 1} из ${requirements.length}. Отправьте файл, дождитесь сохранения (${cmd("/taskfiles")}), затем введите его номер. Если доказательства нет — ${cmd("нет причина")}.\n`,
            `Дәлел ${Number(report.index) + 1} / ${requirements.length}. Файл жіберіп, сақталуын күтіңіз (${cmd("/taskfiles")}), содан кейін нөмірін жазыңыз. Дәлел жоқ болса — ${cmd("жоқ себеп")}.\n`,
          ) + filesText(t),
        );
      }
      return save({
        text: pick(
          L,
          `Отчёт подготовлен. ${cmd("/submitreport")} — отправить на проверку.`,
          `Есеп дайын. ${cmd("/submitreport")} — тексеруге жіберу.`,
        ),
        buttons: [[btn(pick(L, "Отправить отчёт", "Есепті жіберу"), "/submitreport")]],
      });
    }
    return save(workerHelp(L));
  });
}
