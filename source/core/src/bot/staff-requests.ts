import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { DbExecutor } from "../db/client.ts";
import {
  invalid,
  jsonValue,
  type Row,
} from "../domains/registry/validation.ts";
import { ApiError } from "../errors/api.ts";
import { requireRequest } from "../domains/requests/access.ts";
import {
  listStaffRequests,
  requireRequestManager,
} from "../domains/requests/staff-queries.ts";
import {
  markStaffRead,
  staffTimeline,
  type TimelineSection,
} from "../domains/requests/staff-timeline.ts";
import {
  allowedActions,
  checkVersion,
  CLOSED_STATES,
} from "../domains/requests/fsm.ts";
import { editRequest, transitionRequest } from "../domains/requests/service.ts";
import { addMessage } from "../domains/requests/messages.ts";
import {
  planRequestRework,
  startRequestWork,
} from "../domains/tasks/start-request-work.ts";
import {
  listTaskAssignees,
  requireTaskAssignee,
} from "../domains/tasks/assignees.ts";
import {
  createTask,
  getTask,
  transitionTask,
} from "../domains/tasks/service.ts";
import { fileUrl } from "../domains/requests/files.ts";
import { allowedTaskActions } from "../domains/tasks/fsm.ts";
import { loadDialog, saveDialog } from "./dialog.ts";
import { actorForTelegram } from "./registration.ts";
import {
  STAFF_REQUEST_ACTIONS,
  staffFormFields,
} from "./staff-request-forms.ts";
import { message, messageButton, safeBlock } from "../templates/message.ts";
import { botErrorText, BotTemplateError } from "./bot-errors.ts";
import { btn, type InlineButton } from "./keyboard.ts";
import { esc, fmtDate } from "./text.ts";
import { preview } from "./request-text.ts";
import { requestStateText } from "../locales/requests.ts";
import { TASK_STATE_TEXT } from "../locales/tasks.ts";
import { parseVisitWhen } from "./visit-time.ts";
export const STAFF_REQUEST_COMMANDS = [
  "/staffrequests",
  "/staffrequest",
  "/sr",
];
const uuid = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
export type StaffReply = { text: string; buttons: InlineButton[][] };

export async function staffRequestStep(
  deps: RegistryDeps,
  telegramId: string,
  input: string,
  providedActor?: Actor,
): Promise<StaffReply> {
  return deps.db.transaction(async (exec) => {
    const d: RegistryDeps = {
      ...deps,
      bot: "worker",
      db: {
        ...deps.db,
        query: exec.query.bind(exec),
        transaction: <T>(fn: (e: DbExecutor) => Promise<T>) => fn(exec),
      },
    };
    const actor = providedActor ?? await actorForTelegram(d, telegramId);
    if (!actor) throw new ApiError("FORBIDDEN");
    requireRequestManager(actor);
    const L = actor.profile.language;
    const text = (key: string, vars: Row = {}) =>
      message(deps.templates, L, `staff.${key}`, vars);
    const label = (id: string) =>
      messageButton(deps.templates, L, "staff.controls", id);
    const state = await loadDialog(
      exec,
      telegramId,
      "worker",
      actor.profile.id,
      actor.emulation?.sessionId ?? null,
    );
    const wasStaff = state.scenario === "staff-requests";
    if (!wasStaff) { for (const key of Object.keys(state)) delete state[key]; }
    state.scenario = "staff-requests";
    let buttons: InlineButton[][] = [];
    const beginScreen = () => {
      state.token = crypto.randomUUID().slice(0, 12);
      buttons = [];
    };
    const button = (id: string, command = id) =>
      btn(label(id), `/sr ${state.token} ${command}`);
    const rawButton = (title: string, command: string) =>
      btn(title, `/sr ${state.token} ${command}`);
    const result = async (body: string) => {
      await saveDialog(exec, telegramId, "worker", state);
      return { text: body, buttons };
    };
    const block = (body: string) =>
      text("content", { content: safeBlock(body) });
    const current = async () => {
      if (!state.request_id) throw new ApiError("NOT_FOUND");
      try {
        return await requireRequest(
          exec,
          actor,
          String(state.request_id),
          "request.manage",
        );
      } catch (error) {
        if (error instanceof ApiError && error.code === "FORBIDDEN") {
          throw new ApiError("NOT_FOUND");
        }
        throw error;
      }
    };
    const home = async () => {
      beginScreen();
      state.screen = "home";
      delete state.form;
      buttons = [["new", "unassigned"], ["attention", "mine"], [
        "all",
        "by_number",
      ]].map((row) =>
        row.map((id) =>
          button(id, id === "by_number" ? "number" : `queue ${id}`)
        )
      );
      return result(text("home"));
    };
    const card = async (prefix = "") => {
      const r = await current();
      beginScreen();
      state.screen = "card";
      delete state.form;
      delete state.task_id;
      const [extra] = await exec.query<Row>(
        `select (select full_name from person where id=r.assigned_admin_person_id) as manager_name,
     concat_ws(', ',b.name,p.number,r.location_text) as place_label,
     (select admin_close_after from request_confirmation where request_id=r.id and version=r.confirmation_version) as admin_close_after,
     exists(select 1 from connection c where c.person_id=r.author_person_id and c.status='active' and (r.premises_id is null or c.premises_id=r.premises_id)) as author_active
     from request r left join building b on b.id=r.building_id left join premises p on p.id=r.premises_id where r.id=$1`,
        [r.id],
      );
      buttons = [["messages", "files"], ["tasks", "history"]].map((row) =>
        row.map((id) => button(id, `section ${id}`))
      );
      const offered = allowedActions(r.state).filter((a) =>
        STAFF_REQUEST_ACTIONS.includes(a)
      ).filter((a) =>
        !(["approve_cancel", "reject_cancel"].includes(a) &&
          !r.cancel_request) &&
        !(a === "uphold_appeal" &&
          (!r.appeal_by_chairman ||
            !actor.assignments.some((a) => a.role === "chairman"))) &&
        !(a === "admin_close" && extra?.author_active &&
          (!extra.admin_close_after ||
            Date.parse(String(extra.admin_close_after)) > Date.now()))
      );
      if (!CLOSED_STATES.includes(r.state)) {
        buttons.push([
          button("answer", "begin answer"),
          button("note", "begin note"),
        ]);
      }
      for (const action of offered) {
        buttons.push([button(action, `begin ${action}`)]);
      }
      if (
        !CLOSED_STATES.includes(r.state) && r.state !== "awaiting_confirmation"
      ) {
        buttons.push([
          button("add_task", "begin add_task"),
          button("properties"),
        ]);
      }
      buttons.push([button("back", "list")]);
      const overdue = !CLOSED_STATES.includes(r.state) &&
        ((!r.first_response_at &&
          Date.parse(String(r.first_response_due_at)) < Date.now()) ||
          (r.state !== "awaiting_confirmation" &&
            Date.parse(String(r.due_at)) < Date.now()));
      return result(
        prefix + (overdue ? `⚠️ ${esc(label("overdue"))}\n` : "") +
          message(deps.templates, L, "staff.card", {
            number: r.number,
            state: requestStateText(r.state, L),
            place: extra?.place_label || r.location_text || "—",
            description: r.description,
            manager: extra?.manager_name || "—",
            first_due: r.first_response_at
              ? "—"
              : fmtDate(r.first_response_due_at),
            due: fmtDate(r.due_at),
          }),
      );
    };
    const list = async () => {
      beginScreen();
      state.screen = "list";
      delete state.form;
      const filter = (state.filter ?? { queue: "new" }) as Row;
      const cursors = (state.cursors ?? [null]) as (string | null)[];
      state.page = Number(state.page ?? 0);
      let page = await listStaffRequests(exec, actor, {
        ...filter,
        cursor: cursors[Number(state.page)],
      });
      if (!page.items.length && Number(state.page) > 0) {
        state.page = Number(state.page) - 1;
        page = await listStaffRequests(exec, actor, {
          ...filter,
          cursor: cursors[Number(state.page)],
        });
      }
      state.next_cursor = page.next_cursor;
      const username = deps.workerBotUsername ?? "munar_tau_worker_bot";
      if (!/^[A-Za-z0-9_]+$/.test(username)) throw new ApiError("INTERNAL");
      const lines = page.items.map((r) =>
        `<a href="https://t.me/${username}?start=sreq_${esc(r.id)}">${
          esc(r.number)
        }</a> · ${esc(preview(r.description, 100))}\n${
          esc(r.place_label ?? r.location_text ?? "—")
        } · ${esc(requestStateText(r.state, L))}${
          ["current_overdue", "unread", "report_pending", "assignment_declined"]
            .filter((k) => r[k]).map((k) =>
              ` · ${esc(label(k === "current_overdue" ? "overdue" : k))}`
            ).join("")
        }${r.cancel_request ? ` · ${esc(label("cancel_pending"))}` : ""}`
      );
      const nav: InlineButton[] = [];
      if (Number(state.page) > 0) nav.push(button("previous"));
      if (page.next_cursor) nav.push(button("next"));
      if (nav.length) buttons.push(nav);
      buttons.push([button("filters"), button("by_number", "number")], [
        button("back", "home"),
      ]);
      return result(
        block(
          `<b>${esc(label(String(filter.queue ?? "new")))}</b>\n${
            lines.join("\n\n") || esc(text("empty"))
          }`,
        ),
      );
    };
    const section = async (kind: TimelineSection, page = 0) => {
      const r = await current(),
        data = await staffTimeline(exec, actor, String(r.id), kind, page);
      beginScreen();
      state.screen = kind;
      state.section_page = page;
      const lines = data.items.map((m) =>
        kind === "messages"
          ? `${esc(fmtDate(m.created_at))} · ${esc(m.author_name ?? "—")} · ${
            esc(text(m.channel === "internal" ? "internal" : "resident"))
          }\n${esc(m.text)}`
          : kind === "history"
          ? `${esc(fmtDate(m.at))} · ${esc(requestStateText(m.to_state, L))}\n${
            esc(m.reason)
          }`
          : kind === "tasks"
          ? `<a href="https://t.me/${
            deps.workerBotUsername ?? "munar_tau_worker_bot"
          }?start=stsk_${esc(m.id)}">${esc(m.number)}</a> · ${esc(m.title)} · ${
            esc(TASK_STATE_TEXT[String(m.state)]?.[L] ?? m.state)
          }`
          : `${esc(m.filename)} · ${esc(m.status)}`
      );
      if (kind === "messages") {
        state.read_ids = data.items.filter((m) =>
          m.incoming && m.channel === "resident"
        ).map((m) => m.id);
        if ((state.read_ids as unknown[]).length) {
          buttons.push([button("read")]);
        }
      }
      if (kind === "files") {
        data.items.forEach((m, i) =>
          buttons.push([rawButton(String(m.filename), `file ${i}`)])
        );
      }
      if (kind === "files") state.file_ids = data.items.map((m) => m.id);
      const nav: InlineButton[] = [];
      if (page > 0) nav.push(button("previous", `section ${kind} ${page - 1}`));
      if (data.has_more) {
        nav.push(button("next", `section ${kind} ${page + 1}`));
      }
      if (nav.length) buttons.push(nav);
      buttons.push([button("back", "card")]);
      return result(
        block(
          `<b>${esc(r.number)} · ${esc(label(kind))}</b>\n${
            lines.join("\n\n") || esc(text("empty"))
          }`,
        ),
      );
    };
    const taskCard = async () => {
      const r = await current();
      const t = await getTask(d, actor, String(state.task_id));
      if (t.request_id !== r.id) throw new ApiError("NOT_FOUND");
      if (!t.can_manage) throw new ApiError("FORBIDDEN");
      beginScreen();
      state.screen = "task";
      delete state.form;
      const reports = (t.reports ?? []) as Row[], report = reports.at(-1);
      state.report = report ?? null;
      const actions = allowedTaskActions(
        t.state as Parameters<typeof allowedTaskActions>[0],
      );
      if (actions.includes("assign") || actions.includes("reassign")) {
        buttons.push([button("assign", "begin task_assign")]);
      }
      if (t.can_approve) {
        buttons.push([button("approve", "begin task_approve")]);
      }
      if (actions.includes("return")) {
        buttons.push([button("return", "begin task_return")]);
      }
      if (actions.includes("resume")) {
        buttons.push([button("resume", "begin task_resume")]);
      }
      if (actions.includes("suspend")) {
        buttons.push([button("pause_tasks", "begin task_suspend")]);
      }
      if (t.state === "canceled" && t.is_required) {
        buttons.push([button("replacement", "begin task_replace_canceled")]);
      }
      if (report) buttons.push([button("report_files", "reportfiles")]);
      if (actions.includes("cancel")) {
        buttons.push([button("cancel_task", "begin task_cancel")]);
      }
      buttons.push([button("back", "section tasks")]);
      const checklist = jsonValue<Row[]>(t.required_evidence ?? []).map(
        (item) =>
          `${esc(item.id)} · ${
            esc(label(item.required ? "required" : "optional"))
          }`,
      ).join("\n");
      const evidence = report
        ? jsonValue<Row[]>(report.evidence ?? []).map((item) =>
          `${esc(item.requirementId)}: ${
            esc(
              item.missingReason ??
                (item.attachmentIds as unknown[] ?? []).length,
            )
          }`
        ).join("\n")
        : "";
      return result(
        block(
          `<b>${esc(t.number)}</b> · ${
            esc(TASK_STATE_TEXT[String(t.state)]?.[L] ?? t.state)
          }\n${esc(t.title)}\n${esc(t.instruction)}\n${
            esc(t.assignee_name ?? "—")
          } · ${esc(fmtDate(t.due_at))}${
            report
              ? `\n\n${esc(report.performed_work)}\n${esc(report.result)}\n${
                esc(report.limitations)
              }\n${checklist}\n${evidence}`
              : ""
          }`,
        ),
      );
    };
    const prompt = async () => {
      const form = state.form as Row,
        fields = form.fields as string[],
        values = form.values as Row,
        field = fields[Number(form.step)];
      beginScreen();
      if (!field) {
        buttons = [[button("confirm")], [button("cancel", "card")]];
        const summary = Object.entries(values).filter(([k]) =>
          !["building_id", "premises_id"].includes(k)
        ).map(([k, v]) =>
          `${
            esc(
              k === "assignee"
                ? label("assign")
                : ["due_at", "rework_due_at", "next_action_at"].includes(k)
                ? label("period")
                : labelForField(k),
            )
          }: ${
            esc(
              k === "assignee_person_id"
                ? form.assignee_name
                : k==='category'?form.category_name:k==='replacement'?form.replacement_name
                : ["due_at", "rework_due_at", "next_action_at"].includes(k)
                ? fmtDate(v)
                : k === "required"
                ? label(v ? "required" : "optional")
                : ["kind", "urgency", "task_policy"].includes(k)
                ? label(String(v))
                : v,
            )
          }`
        ).join("\n");
        const attachmentIds=(form.attachment_ids??[]) as string[];
        const attachments=attachmentIds.length?await exec.query<Row>('select filename,status from attachment where id=any($1::uuid[]) and request_id=$2 and uploaded_by=$3 order by created_at,id',[attachmentIds,form.request_id,actor.person.id]):[];
        const files=attachments.length?'\n'+esc(label('files'))+':\n'+attachments.map(file=>esc(file.filename)+(file.status==='complete'?'':' · '+esc(text('pending_files')))).join('\n'):'';
        return result(
          block(
            `${esc(text("preview"))}\n<b>${esc(form.title)}</b>\n${
              ["answer", "note"].includes(String(form.action))
                ? esc(
                  text(form.channel === "internal" ? "internal" : "resident"),
                ) + "\n"
                : ""
            }${summary}${files}${
              form.action === "task_approve"
                ? "\n" + esc(text("report_check"))
                : ""
            }`,
          ),
        );
      }
      if (field === "building_code") {
        buttons = [[button("cancel", "card")]];
        return result(text("building_code"));
      }
      if (field === "replacement" || field === "premises") {
        const r = await current();
        const choices = field === "replacement"
          ? await exec.query<Row>(
            "select id,number as name from task where request_id=$1 and id<>$2 and is_required and state<>'canceled' order by number",
            [r.id, state.task_id],
          )
          : await exec.query<Row>(
            "select p.id,p.number as name from premises p join connection c on c.premises_id=p.id where p.building_id=$1 and c.person_id=$2 and c.status='active' and p.status='active' order by p.number",
            [values.building_id, r.author_person_id],
          );
        state.choice_ids = choices.map((c) => c.id);
        state.choice_names=choices.map(c=>c.name);
        buttons = choices.map((
          c,
          i,
        ) => [rawButton(String(c.name), `value ${i}`)]);
        if (field === "premises") {
          buttons.push([button("none", `value ${choices.length}`)]);
        }
        buttons.push([button("cancel", "card")]);
        return result(
          text(
            field === "replacement" && !choices.length
              ? "no_replacement"
              : "select",
          ),
        );
      }
      if (field === "assignee") {
        const r = await current(),
          people = await listTaskAssignees(
            exec,
            actor.person.isTest,
            r.building_id ? [String(r.building_id)] : [],
          );
        state.assignee_ids = people.map((p) => p.id);
        state.assignee_names = people.map((p) => p.full_name);
        buttons = people.map((p, i) => [rawButton(p.full_name, `value ${i}`)]);
        buttons.push([button("cancel", "card")]);
        return result(text(people.length ? "assignee" : "no_assignees"));
      }
      const options: Record<string, string[]> = {
        required: ["required", "optional"],
        task_policy: ["continue_tasks", "pause_tasks"],
        kind: ["request", "question", "complaint"],
        urgency: ["low", "normal", "high", "critical"],
      };
      if (field === "category") {
        const rows = await exec.query<Row>(
          "select id,name_ru,name_kk from request_category where active order by name_ru",
        );
        state.category_ids = rows.map((r) => r.id);
        state.category_names=rows.map(r=>r[L==='kk'?'name_kk':'name_ru']);
        buttons = rows.map((
          r,
          i,
        ) => [
          rawButton(
            String(r[L === "kk" ? "name_kk" : "name_ru"]),
            `value ${i}`,
          ),
        ]);
      } else if (options[field]) {
        buttons = options[field]!.map((
          v,
          i,
        ) => [rawButton(label(v), `value ${i}`)]);
      }
      buttons.push([button("cancel", "card")]);
      return result(
        text(
          field.startsWith("evidence_reason:")
            ? "evidence_reason"
            : ["assignee", "required"].includes(field)
            ? field
            : options[field] || field === "category"
            ? "select"
            : field,
        ),
      );
    };
    const labelForField = (field: string) => {
      if (field.startsWith("evidence_reason:")) {
        return label("evidence_label") + " " + field.slice(16);
      }
      const names: Record<string, string> = {
        building_code: "building",
        replacement: "replacement",
        text: "answer",
        reason: "reason_label",
        plan: "plan_label",
        summary: "submit_result",
        question: "ask_clarification",
        route: "route_label",
        stop_resolution: "stop_label",
        verification_method: "verify_label",
        verification_materials: "files",
        location_text: "place",
        assignee_person_id: "assign",
        task_policy: "task_policy",
        required: "required",
        kind: "kind",
        category: "category",
        urgency: "urgency",
        evidence_reason: "evidence_label",
        dependency_review: "dependency_label",
      };
      return label(names[field] ?? field);
    };
    const beginForm = async (action: string) => {
      const r = await current();
      let task: Row | undefined;
      if (action.startsWith("task_")) {
        task = await getTask(d, actor, String(state.task_id));
        if (task.request_id !== r.id || !task.can_manage) {
          throw new ApiError("FORBIDDEN");
        }
        const report = ((task.reports ?? []) as Row[]).at(-1);
        task.missing_evidence = report
          ? jsonValue(report.missing_evidence)
          : [];
        if (action === "task_approve" && !task.can_approve) {
          throw new ApiError("FORBIDDEN");
        }
      } else if (
        STAFF_REQUEST_ACTIONS.includes(action) &&
        !allowedActions(r.state).includes(action)
      ) throw new ApiError("INVALID_TRANSITION");
      else if (
        !STAFF_REQUEST_ACTIONS.includes(action) &&
        !["answer", "note", "add_task", "kind", "category", "urgency", "place"]
          .includes(action)
      ) throw new ApiError("VALIDATION_FAILED");
      const fields = staffFormFields(action, r, task);
      if (action === "ask_clarification") {
        fields.splice(fields.indexOf("task_policy"), 0, "next_action_at");
      }
      state.form = {
        request_id: r.id,
        task_id: task?.id,
        action,
        fields,
        step: 0,
        values: {},
        version: r.version,
        task_version: task?.version,
        report_version: ((task?.reports ?? []) as Row[]).at(-1)?.version,
        operation: crypto.randomUUID(),
        title: action.startsWith("task_")
          ? label(
            action === "task_assign"
              ? "assign"
              : action === "task_cancel"
              ? "cancel_task"
              : action === "task_replace_canceled"
              ? "replacement"
              : action === "task_suspend"
              ? "pause_tasks"
              : action.slice(5),
          )
          : label(action),
        channel: action === "note" ? "internal" : "resident",
        attachment_ids: [],
        missing_evidence: task?.missing_evidence ?? [],
      };
      state.screen = "form";
      return prompt();
    };
    const submit = async () => {
      const form = state.form as Row;
      if (!form || Number(form.step) !== (form.fields as unknown[]).length) {
        throw new ApiError("VALIDATION_FAILED");
      }
      const r = await current(),
        v = form.values as Row,
        a = String(form.action),
        key = `worker:staff:${form.operation}`;
      if (
        form.request_id !== r.id ||
        (a.startsWith("task_") && form.task_id !== state.task_id)
      ) throw new ApiError("CONCURRENT_MODIFICATION");
      checkVersion(r.version, form.version);
      if (a === "answer" || a === "note") {
        const attachments = form.attachment_ids as string[];
        if (attachments.length) {
          const files = await exec.query<Row>(
            `select id,status from attachment where id=any($1::uuid[]) and uploaded_by=$2 and request_id=$3 and bucket=$4 and owner_type='request'`,
            [attachments, actor.person.id, r.id, form.channel],
          );
          if (
            files.length !== attachments.length ||
            files.some((f) => f.status !== "complete")
          ) {
            throw new BotTemplateError(
              "VALIDATION_FAILED",
              text("pending_files"),
            );
          }
        }
        await addMessage(d, actor, String(r.id), {
          text: v.text,
          channel: form.channel,
          attachments,
          source: "bot",
        }, key);
      } else if (a === "start_work") {
        await startRequestWork(d, actor, String(r.id), {
          ...v,
          expected_version: form.version,
        }, key);
      } else if (a === "plan_rework") {
        await planRequestRework(d, actor, String(r.id), {
          ...v,
          expected_version: form.version,
        }, key);
      } else if (a === "add_task") {
        await createTask(d, actor, {
          request_id: r.id,
          title: preview(v.plan, 120),
          instruction: v.plan,
          assignee_person_id: v.assignee_person_id,
          due_at: v.due_at,
          is_required: v.required,
        }, key);
      } else if (a.startsWith("task_")) {
        let t = await getTask(d, actor, String(state.task_id));
        if (t.request_id !== r.id) throw new ApiError("NOT_FOUND");
        checkVersion(Number(t.version), form.task_version);
        if (a === "task_assign") {
          await requireTaskAssignee(
            exec,
            String(v.assignee_person_id),
            actor.person.isTest,
          );
          if (t.state !== "created") {
            t = await transitionTask(d, actor, String(t.id), {
              action: "reassign",
              version: t.version,
              reason: v.reason,
            }, key + ":remove");
          }
          await transitionTask(d, actor, String(t.id), {
            action: "assign",
            version: t.version,
            assignee_person_id: v.assignee_person_id,
          }, key + ":assign");
        } else {await transitionTask(d, actor, String(t.id), {
            action: a.slice(5),
            version: t.version,
            report_version: form.report_version,
            reason: v.reason,
            rework_due_at: v.rework_due_at,
            expected_result: v.plan,
            dependency_review: v.dependency_review,
            result_checked: a === "task_approve",
            stop_checked: true,
            replacement_task_id: v.replacement,
            next_action: v.reason,
            next_action_at: v.next_action_at,
            evidence_decisions: (form.missing_evidence as string[]).map(
              (id) => ({
                requirement_id: id,
                reason: v[`evidence_reason:${id}`],
              }),
            ),
          }, key);}
      } else if (["kind", "category", "urgency", "place"].includes(a)) {
        await editRequest(d, actor, String(r.id), {
          expected_version: form.version,
          reason: v.reason,
          ...(a === "place"
            ? {
              building_id: v.building_id,
              premises_id: v.premises_id,
              location_text: v.location_text,
            }
            : a === "category"
            ? { category_id: v.category }
            : { [a]: v[a] }),
        });
      } else {
        if (v.task_policy === "pause_tasks") {
          const tasks = await exec.query<Row>(
            `select id,version from task where request_id=$1 and state in ('accepted','in_progress') order by id`,
            [r.id],
          );
          for (const t of tasks) {
            await transitionTask(d, actor, String(t.id), {
              action: "suspend",
              version: t.version,
              reason: v.reason,
              next_action: v.question ?? v.reason,
              next_action_at: v.next_action_at ?? r.due_at,
            }, `${key}:pause:${t.id}`);
          }
        }
        await transitionRequest(d, actor, String(r.id), {
          action: a,
          expected_version: form.version,
          reason: v.reason,
          payload: {
            ...v,
            responsible_person_id: actor.person.id,
            confirmation_payload: { summary: v.summary },
          },
        }, key);
      }
      delete state.form;
      return a.startsWith("task_") ? taskCard() : card(text("done") + "\n");
    };
    const [command, token, verb, ...args] = input.trim().split(/\s+/);
    if (command === "/staffrequests") return home();
    if (
      command === "/staffrequest" ||
      (command === "/start" && token?.startsWith("sreq_"))
    ) {
      const number = command === "/start" ? token!.slice(5) : token;
      const [found] = await exec.query<{ id: string }>(
        "select id from request where number=$1 or id::text=lower($1)",
        [number ?? ""],
      );
      if (!found) throw new ApiError("NOT_FOUND");
      state.request_id = found.id;
      return card();
    }
    if (command === "/start" && token?.startsWith("stsk_")) {
      const id = token.slice(5);
      if (!uuid(id)) throw new ApiError("NOT_FOUND");
      const t = await getTask(d, actor, id);
      if (!t.request_id) throw new ApiError("NOT_FOUND");
      state.request_id = t.request_id;
      state.task_id = id;
      return taskCard();
    }
    if (command === "/sr") {
      if (!wasStaff || token !== state.token) {
        beginScreen();
        buttons = [[button("back", "home")]];
        return result(text("stale"));
      }
      if (verb === "home") return home();
      if (verb === "card") return card();
      if (verb === "list") return list();
      if (verb === "queue") {
        state.filter = { queue: args[0] };
        state.page = 0;
        state.cursors = [null];
        return list();
      }
      if (verb === "next") {
        if (state.next_cursor) {
          state.page = Number(state.page) + 1;
          (state.cursors as unknown[])[Number(state.page)] = state.next_cursor;
        }
        return list();
      }
      if (verb === "previous") {
        state.page = Math.max(0, Number(state.page) - 1);
        return list();
      }
      if (verb === "section") {
        return section(args[0] as TimelineSection, Number(args[1] ?? 0));
      }
      if (verb === "read") {
        await markStaffRead(
          exec,
          actor,
          String(state.request_id),
          state.read_ids,
        );
        return section("messages", Number(state.section_page ?? 0));
      }
      if (verb === "reportfiles") {
        await current();
        const t = await getTask(d, actor, String(state.task_id));
        if (t.request_id !== state.request_id || !t.can_manage) {
          throw new ApiError("NOT_FOUND");
        }
        const report = ((t.reports ?? []) as Row[]).at(-1);
        beginScreen();
        state.screen = "reportfiles";
        const files = report
          ? await exec.query<Row>(
            "select id,filename from attachment where task_id=$1 and task_report_id=$2 order by filename,id",
            [t.id, report.id],
          )
          : [];
        state.file_ids = files.map((f) => f.id);
        buttons = files.map((
          f,
          i,
        ) => [rawButton(String(f.filename), `file ${i}`)]);
        buttons.push([button("back", "taskcard")]);
        return result(
          block(files.map((f) => esc(f.filename)).join("\n") || text("empty")),
        );
      }
      if (verb === "taskcard") return taskCard();
      if (verb === "file") {
        await current();
        const ids = state.file_ids as string[] | undefined,
          id = ids?.[Number(args[0])];
        if (!id) throw new ApiError("NOT_FOUND");
        const returnTo = state.screen === "reportfiles"
          ? "taskcard"
          : "section files";
        beginScreen();
        buttons = [[button("back", returnTo)]];
        if (!d.fileStorage) return result(text("file_unavailable"));
        const file = await fileUrl(d, d.fileStorage, actor, id);
        return result(
          block(`<a href="${esc(file.url)}">${esc(label("files"))}</a>`),
        );
      }
      if (verb === "begin") return beginForm(args[0]!);
      if (verb === "review" && state.form) return prompt();
      if (verb === "confirm") {
        await exec.query("savepoint staff_operation");
        try {
          return await submit();
        } catch (error) {
          await exec.query("rollback to savepoint staff_operation");
          if (!(error instanceof ApiError)) throw error;
          if (
            error instanceof BotTemplateError &&
            error.message === text("pending_files")
          ) {
            const reply = await prompt();
            return { ...reply, text: error.message + "\n" + reply.text };
          }
          delete state.form;
          return card(botErrorText(error, L, deps.templates) + "\n");
        }
      }
      if (verb === "properties") {
        await current();
        beginScreen();
        buttons = ["kind", "category", "urgency", "place"].map(
          (id) => [button(id, `begin ${id}`)],
        );
        buttons.push([button("back", "card")]);
        return result(text("select"));
      }
      if (verb === "number" || verb === "search" || verb === "period") {
        beginScreen();
        state.screen = verb;
        buttons = [[button("cancel", "list")]];
        return result(text(verb));
      }
      if (verb === "filters") {
        beginScreen();
        buttons = ["status", "building", "period", "search", "reset"].map(
          (id) => [button(id)],
        );
        buttons.push([button("back", "list")]);
        return result(text("select"));
      }
      if (verb === "reset") {
        state.filter = { queue: (state.filter as Row)?.queue ?? "all" };
        state.page = 0;
        state.cursors = [null];
        return list();
      }
      if (verb === "status") {
        beginScreen();
        buttons = [
          "new",
          "reviewing",
          "need_clarification",
          "in_work",
          "on_hold",
          "awaiting_confirmation",
          "rework",
          "closed",
          "canceled",
          "rejected",
        ].map(
          (id) => [rawButton(requestStateText(id, L), `filterstate ${id}`)],
        );
        buttons.push([button("back", "list")]);
        return result(text("select"));
      }
      if (verb === "filterstate" || verb === "house") {
        const id = verb === "filterstate"
          ? args[0]
          : args[0] === "none"
          ? "none"
          : (state.building_ids as string[])[Number(args[0])];
        if (!id) throw new ApiError("NOT_FOUND");
        state.filter = {
          ...(state.filter as Row ?? {}),
          [verb === "filterstate" ? "state" : "building_id"]: id,
        };
        state.page = 0;
        state.cursors = [null];
        return list();
      }
      if (verb === "building") {
        beginScreen();
        const houses = await exec.query<Row>(
          "select id,name,code from building order by code",
        );
        state.building_ids = houses.map((h) => h.id);
        buttons = houses.map((
          h,
          i,
        ) => [rawButton(String(h.name), `house ${i}`)]);
        buttons.push([button("none", "house none")], [button("back", "list")]);
        return result(text("select"));
      }
      if (verb === "value" && state.form) {
        const form = state.form as Row,
          field = (form.fields as string[])[Number(form.step)]!,
          index = Number(args[0]),
          values = form.values as Row;
        if (!Number.isSafeInteger(index) || index < 0) {
          invalid("Некорректный выбор");
        }
        if (field === "assignee") {
          const ids = state.assignee_ids as string[], id = ids[index];
          if (!id) throw new ApiError("NOT_FOUND");
          await requireTaskAssignee(exec, id, actor.person.isTest);
          values.assignee_person_id = id;
          form.assignee_name = (state.assignee_names as string[])[index];
        } else if (field === "replacement" || field === "premises") {
          const ids = state.choice_ids as string[];
          if (field === "replacement" && !ids[index]) {
            throw new ApiError("NOT_FOUND");
          }
          if (field === "premises" && index > ids.length) {
            throw new ApiError("NOT_FOUND");
          }
          values[field === "premises" ? "premises_id" : "replacement"] =
            ids[index] ?? null;
          form[field+'_name']=(state.choice_names as string[]|undefined)?.[index]??label('none');
        } else if (field === "category") {
          const id = (state.category_ids as string[])[index];
          if (!id) throw new ApiError("NOT_FOUND");
          values.category = id;
          form.category_name=(state.category_names as string[])[index];
        } else {
          const options: Record<string, unknown[]> = {
            required: [true, false],
            task_policy: ["continue_tasks", "pause_tasks"],
            kind: ["request", "question", "complaint"],
            urgency: ["low", "normal", "high", "critical"],
          };
          if (!options[field] || index >= options[field]!.length) {
            invalid("Некорректный выбор");
          }
          values[field] = options[field]![index];
        }
        form.step = Number(form.step) + 1;
        return prompt();
      }
      return home();
    }
    if (command?.startsWith("/")) return home();
    if (state.screen === "number") {
      return staffRequestStep(
        d,
        telegramId,
        `/staffrequest ${input.trim()}`,
        actor,
      );
    }
    if (state.screen === "search") {
      state.filter = { ...(state.filter as Row ?? {}), search: input.trim() };
      state.page = 0;
      state.cursors = [null];
      return list();
    }
    if (state.screen === "period") {
      const dates = input.match(/\d{2}\.\d{2}\.\d{4}/g);
      if (!dates || dates.length !== 2) {
        throw new BotTemplateError("VALIDATION_FAILED", text("period"));
      }
      const from = parseVisitWhen(dates[0] + " 00:00")?.start,
        to = parseVisitWhen(dates[1] + " 23:59")?.start;
      if (!from || !to || Date.parse(from) > Date.parse(to)) {
        throw new BotTemplateError("VALIDATION_FAILED", text("period"));
      }
      state.filter = { ...(state.filter as Row ?? {}), from, to };
      state.page = 0;
      state.cursors = [null];
      return list();
    }
    if (state.form) {
      const form = state.form as Row,
        field = (form.fields as string[])[Number(form.step)];
      if (!field) return prompt();
      if (
        [
          "assignee",
          "category",
          "required",
          "task_policy",
          "kind",
          "urgency",
          "replacement",
          "premises",
        ].includes(field)
      ) return prompt();
      let value = input.trim();
      if (!value || value.length > 10000) {
        throw new ApiError("VALIDATION_FAILED");
      }
      if (["due_at", "next_action_at", "rework_due_at"].includes(field)) {
        const parsed = parseVisitWhen(value);
        if (!parsed || Date.parse(parsed.start) <= Date.now()) {
          throw new BotTemplateError("VALIDATION_FAILED", text("bad_date"));
        }
        value = parsed.start;
      }
      if (field === "building_code") {
        const [building] = await exec.query<Row>(
          "select id,name from building where code=$1",
          [value],
        );
        if (!building) throw new ApiError("NOT_FOUND");
        (form.values as Row).building_id = building.id;
        form.building_name = building.name;
      }
      (form.values as Row)[field] = value;
      form.step = Number(form.step) + 1;
      return prompt();
    }
    return home();
  });
}
