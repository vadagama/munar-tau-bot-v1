import { ApiError } from "../errors/api.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { content } from "../domains/requests/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { addDocumentVersion, getDocument, listDocuments, transitionDocumentVersion } from "../domains/documents/service.ts";
import { listObligations } from "../domains/documents/obligations.ts";
import { prepareFile, fileUrl } from "../domains/requests/files.ts";
import { loadDialog, saveDialog } from "./dialog.ts";
import { actorForTelegram } from "./registration.ts";
import { btn, type BotReply, type InlineButton } from "./keyboard.ts";
import { esc, fmtDate } from "./text.ts";
import { message, messageButton, safeBlock } from "../templates/message.ts";
export const DOCUMENT_COMMANDS = ["/documents", "/doc", "/dc", "/docform", "/docduties"];
interface Form { token: string; document_id: string; expected_version: number; action: string; document_version: number; step: string; values: Row }
const nonce = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);

export async function documentStep(deps: RegistryDeps, telegram: string, input: string, providedActor?: Actor): Promise<BotReply> {
  const actor = providedActor ?? await actorForTelegram(deps, telegram);
  if (!actor) throw new ApiError("FORBIDDEN");
  const bot = deps.bot ?? "resident", lang = actor.profile.language;
  const state = await loadDialog(deps.db, telegram, bot, actor.profile.id, actor.emulation?.sessionId ?? null, "documents");
  const text = (key: string, vars: Row = {}) => message(deps.templates, lang, `documents.${key}`, vars);
  const button = (id: string, command: string) => btn(messageButton(deps.templates, lang, "documents.controls", id), command);
  const back = () => button("back", state.document_id ? `/doc ${state.document_id}` : "/documents");
  const save = () => saveDialog(deps.db, telegram, bot, state);
  const args = input.trim().split(/\s+/), command = args[0]!;
  if (command === "/start" && args[1]?.startsWith("doc_")) return documentStep(deps, telegram, `/doc ${args[1].slice(4)}`, actor);
  let form = state.document_form as Form | undefined;
  if (command === "/documents" || command === "/docduties") {
    delete state.document_form; delete state.document_id; delete state.document_token;
    await save();
    if (command === "/docduties") {
      if (bot !== "worker") throw new ApiError("FORBIDDEN");
      const offset = Number(args[1] ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError("VALIDATION_FAILED");
      const result = await listObligations(deps, actor);
      const own = result.items.filter(o => !o.completed_at && (o.prepared_by === actor.person.id || o.reviewer_id === actor.person.id));
      const paging: InlineButton[] = [];
      if (offset > 0) paging.push(button("prev", `/docduties ${Math.max(0, offset - 10)}`));
      if (offset + 10 < own.length) paging.push(button("next", `/docduties ${offset + 10}`));
      return { text: text("duties", { items: safeBlock(own.slice(offset, offset + 10).map(o => `${esc(o.source_number)}: ${esc(o.basis)} · ${esc(fmtDate(String(o.due_at)))}`).join("\n")) }) + "\n" + text("duty_help"), buttons: [...(paging.length ? [paging] : []), [button("list", "/documents")]] };
    }
    const offset = Number(args[1] ?? 0), result = await listDocuments(deps, actor, offset, 10);
    const buttons = result.items.slice(0, 10).map(d => [btn(messageButton(deps.templates, lang, "documents.controls", "open", { title: d.title }), `/doc ${d.id}`)]);
    const paging: InlineButton[] = [];
    if (offset > 0) paging.push(button("prev", `/documents ${Math.max(0, offset - 10)}`));
    if (offset + 10 < result.total) paging.push(button("next", `/documents ${offset + 10}`));
    if (paging.length) buttons.push(paging);
    if (bot === "worker") buttons.push([button("duties", "/docduties")]);
    else buttons.push([button("request", "/newrequest")]);
    return { text: (result.items.length ? text("list", { items: safeBlock("") }) : text("empty")) + (bot === "resident" ? "\n" + text("access_help") : ""), buttons };
  }
  if (command === "/doc") {
    const card = await getDocument(deps, actor, content(args[1]));
    delete state.document_form;
    state.document_id = card.id; state.document_token = nonce(); state.document_version = card.version;
    await save();
    const v = card.versions[0];
    const actionButton = (id: string) => button(id, `/dc ${state.document_token} ${id}`);
    const buttons: InlineButton[][] = [[button("list", "/documents")]];
    if (v) { buttons.unshift([actionButton("file")]); if (v.signed_attachment_id) buttons[0]!.push(actionButton("signed")); }
    if (bot === "worker") {
      if (card.can_prepare) buttons.push([actionButton("version")]);
      if (card.can_prepare && v?.state === "draft") buttons.push([actionButton("submit")]);
      if (card.can_review && v?.state === "on_review") buttons.push([actionButton("approve"), actionButton("return")]);
      if (card.can_review && v?.state === "approved") buttons.push([actionButton("needs_fix")]);
    }
    const signature = v?.signed_attachment_id && (card.can_prepare || card.can_review || card.can_manage)
      ? "\n" + text("signature_info", { method: "signature_method" in v ? v.signature_method : "—", basis: "signature_basis" in v ? v.signature_basis : "—" }) : "";
    return { text: text("card", { title: card.title, version: v?.version ?? "—", state: v ? text(`state.${v.state}`) : text("no_versions") }) + signature, buttons };
  }
  if (command === "/dc") {
    if (args[1] !== state.document_token || !state.document_id) throw new ApiError("CONCURRENT_MODIFICATION");
    const card = await getDocument(deps, actor, String(state.document_id)), v = card.versions[0], action = args[2]!;
    if (card.version !== state.document_version) throw new ApiError("CONCURRENT_MODIFICATION");
    if (["file", "signed"].includes(action)) {
      const id = action === "file" ? v?.attachment_id : v?.signed_attachment_id;
      if (!id || !deps.fileStorage) throw new ApiError("NOT_FOUND");
      const result = await fileUrl(deps, deps.fileStorage, actor, String(id));
      return { text: text("file", { link: safeBlock(`<a href="${esc(result.url)}">${esc(messageButton(deps.templates, lang, "documents.controls", action))}</a>`) }), buttons: [[back()]] };
    }
    if (bot !== "worker" || !["version", "submit", "approve", "return", "needs_fix"].includes(action) ||
      (["version", "submit"].includes(action) ? !card.can_prepare : !card.can_review) || (action !== "version" && !v)) throw new ApiError("FORBIDDEN");
    form = { token: nonce(), document_id: card.id, expected_version: card.version, document_version: v?.version ?? 0, action, step: action === "version" ? "main_file" : "reason", values: {} };
    state.document_form = form;
    await save();
  } else if (command === "/docform") {
    if (!form || args[1] !== form.token) throw new ApiError("CONCURRENT_MODIFICATION");
    if (args[2] === "unsigned" && form.step === "choose_signed") form.step = "reason";
    else if (args[2] === "signed" && form.step === "choose_signed") form.step = "signed_file";
    else if (args[2] === "confirm" && form.step === "confirm") {
      const key = `document-form:${form.token}`;
      const body = { ...form.values, expected_version: form.expected_version };
      if (form.action === "version") await addDocumentVersion(deps, actor, form.document_id, body, key);
      else await transitionDocumentVersion(deps, actor, form.document_id, form.document_version, form.action, body, key);
      delete state.document_form; await save();
      return documentStep(deps, telegram, `/doc ${form.document_id}`, actor);
    } else throw new ApiError("INVALID_TRANSITION");
    await save();
  } else if (!command.startsWith("/") && form && ["reason", "signature_method", "signature_basis"].includes(form.step)) {
    form.values[form.step] = content(input);
    form.step = form.step === "signature_method" ? "signature_basis" : form.step === "signature_basis" ? "reason" : "confirm";
    await save();
  } else return { text: text("text_only"), buttons: [[back()]] };
  form = state.document_form as Form;
  const buttons = form.step === "choose_signed" ? [[button("signed", `/docform ${form.token} signed`), button("unsigned", `/docform ${form.token} unsigned`)]] : form.step === "confirm" ? [[button("confirm", `/docform ${form.token} confirm`)]] : [];
  buttons.push([back()]);
  return { text: text(`prompt.${form.step}`, { summary: String(form.values.reason ?? "") }), buttons };
}

export async function queueDocumentFile(deps: RegistryDeps, telegram: string, incoming: Row): Promise<BotReply> {
  const actor = await actorForTelegram(deps, telegram);
  if (!actor || deps.bot !== "worker") throw new ApiError("FORBIDDEN");
  const state = await loadDialog(deps.db, telegram, "worker", actor.profile.id, actor.emulation?.sessionId ?? null, "documents");
  const form = state.document_form as Form | undefined;
  const back = btn(messageButton(deps.templates, actor.profile.language, "documents.controls", "back"), state.document_id ? `/doc ${state.document_id}` : "/documents");
  if (!form || !["main_file", "signed_file"].includes(form.step)) return { text: message(deps.templates, actor.profile.language, "documents.text_only"), buttons: [[back]] };
  const file = incoming.document as Row | undefined;
  if (!file || typeof file.file_id !== "string") throw new ApiError("FILE_LIMIT");
  const prepared = await prepareFile(deps, actor, { owner_type: "document", owner_id: form.document_id, expected_version: form.expected_version, filename: file.file_name, size: file.file_size, mime: file.mime_type });
  await deps.db.query("insert into request_upload_job(attachment_id,telegram_file_id,person_id,bot) values($1,$2,$3,'worker')", [prepared.attachment_id, file.file_id, actor.person.id]);
  form.values[form.step === "main_file" ? "attachment_id" : "signed_attachment_id"] = prepared.attachment_id;
  form.step = form.step === "main_file" ? "choose_signed" : "signature_method";
  await saveDialog(deps.db, telegram, "worker", state);
  const buttons = form.step === "choose_signed" ? [[btn(messageButton(deps.templates, actor.profile.language, "documents.controls", "signed"), `/docform ${form.token} signed`), btn(messageButton(deps.templates, actor.profile.language, "documents.controls", "unsigned"), `/docform ${form.token} unsigned`)]] : [[back]];
  return { text: message(deps.templates, actor.profile.language, "documents.file_queued") + "\n" + message(deps.templates, actor.profile.language, `documents.prompt.${form.step}`), buttons };
}
