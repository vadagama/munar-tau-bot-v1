import { ApiError } from "../errors/api.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { getPublication } from "../domains/publications/service.ts";
import { financialOwnerBuildings } from "../domains/publications/financial-access.ts";
import { listFinancialCatalogue } from "../domains/publications/financial-catalog.ts";
import { publicationFile } from "../domains/publications/media.ts";
import { getFinancialObligation, listFinancialObligations } from "../domains/publications/financial-queries.ts";
import { actorForTelegram } from "./registration.ts";
import { loadDialog, saveDialog } from "./dialog.ts";
import { esc, fmtDay, fmtDate } from "./text.ts";
import { message, messageButton, safeBlock } from "../templates/message.ts";
import { btn, type BotReply, type InlineButton } from "./keyboard.ts";
export const FINANCIAL_COMMANDS = ["/financial", "/fv", "/fa", "/fc", "/financialduties", "/fd"];
export async function financialStep(deps: RegistryDeps, telegram: string, input: string, providedActor?: Actor): Promise<BotReply> {
  const actor = providedActor ?? await actorForTelegram(deps, telegram);
  if (!actor) throw new ApiError("FORBIDDEN");
  const bot = deps.bot ?? "resident", lang = actor.profile.language;
  const state = await loadDialog(deps.db, telegram, bot, actor.profile.id, actor.emulation?.sessionId ?? null, "incidents");
  const [command, id, a, b] = input.trim().split(/\s+/);
  const text = (key: string, vars: Row = {}) => message(deps.templates, lang, `financial.${key}`, vars);
  const button = (key: string, data: string, vars: Row = {}) => btn(messageButton(deps.templates, lang, "financial.controls", key, vars), data);
  const period = (v: Row) => `${fmtDay(v.period_from)} — ${fmtDay(v.period_to)}`;
  const save = () => saveDialog(deps.db, telegram, bot, state);
  const page = (value: string | undefined) => { const n = Number(value ?? 0); if (!Number.isSafeInteger(n) || n < 0 || n > 100000) throw new ApiError("VALIDATION_FAILED"); return n; };
  const paging = (prefix: string, offset: number, more: boolean) => {
    const buttons: InlineButton[] = [];
    if (offset) buttons.push(button("prev", `${prefix} ${Math.max(0, offset - 10)}`));
    if (more) buttons.push(button("next", `${prefix} ${offset + 10}`));
    return buttons.length ? [buttons] : [];
  };
  if (command !== "/fc") { for (const key of Object.keys(state)) if (key !== "scenario") delete state[key]; await save(); }
  async function versions(publicationId: string): Promise<(Row & { documents: Row[] })[]> {
    const card = await getPublication(deps, actor!, publicationId) as Row;
    if (card.kind !== "financial_report") throw new ApiError("NOT_FOUND");
    const owners = bot === "resident" ? await financialOwnerBuildings(deps.db, actor!) : [];
    return ((card.financial_versions as Row[]) ?? []).filter(v => v.published_at && (bot === "worker" || (v.building_ids as string[]).some(id => owners.includes(id))))
      .map(v => ({ ...v, documents: ((v.documents as Row[]) ?? []).filter(d => bot === "worker" || d.disclosed === true) }));
  }
  async function version(versionId: string) {
    const [row] = await deps.db.query<{ publication_id: string }>("select publication_id from financial_publication_version where id=$1", [versionId]);
    if (!row) throw new ApiError("NOT_FOUND");
    const card = (await versions(row.publication_id)).find(v => v.id === versionId);
    if (!card) throw new ApiError("NOT_FOUND");
    return { card, publicationId: row.publication_id };
  }
  if (command === "/financial") {
    const offset = page(id), result = await listFinancialCatalogue(deps.db, actor, bot === "worker" ? "staff" : "owner", offset);
    return { text: result.items.length ? text("list", { items: safeBlock(result.items.map(p => esc(p.title)).join("\n")) }) : text("empty"), buttons: [...result.items.map(p => [button("open", `/fa ${p.publication_id}`, { title: p.title })]), ...paging("/financial", offset, result.has_more), ...(bot === "worker" ? [[button("duties", "/financialduties")]] : [])] };
  }
  if (command === "/fa" && id) {
    const offset = page(a), archive = await versions(id), visible = archive.slice(offset, offset + 10);
    if (!archive.length) throw new ApiError("NOT_FOUND");
    return { text: text("archive", { items: safeBlock(visible.map(v => `${esc(v.version)} · ${esc(period(v))} · ${esc(v.replaced_at ? text("replaced") : text("current"))}`).join("\n")) }), buttons: [...visible.map(v => [button("version", `/fv ${v.id}`, { version: v.version })]), ...paging(`/fa ${id}`, offset, offset + 10 < archive.length), [button("list", "/financial")]] };
  }
  if (command === "/fv" && id) {
    const { card, publicationId } = await version(id);
    state.financial_version_id = id; state.financial_token = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    state.financial_files = card.documents.map(d => ({ attachment_id: d.attachment_id, signed_attachment_id: d.signed_attachment_id }));
    await save();
    const buttons = card.documents.map((d, i) => [button("file", `/fc ${state.financial_token} ${i} 0`, { title: d.title }), ...(d.signed_attachment_id ? [button("signed", `/fc ${state.financial_token} ${i} 1`)] : [])]);
    return { text: text("card", { title: card.title, version: card.version, period: period(card), status: card.replaced_at ? text("replaced") : text("current"), body: card.body }) + (card.correction_note ? `\n${text("correction", { note: card.correction_note })}` : "") + (card.needs_fix ? `\n${text("needs_fix")}` : ""), buttons: [...buttons, [button("archive", `/fa ${publicationId}`), button("list", "/financial")]] };
  }
  if (command === "/fc") {
    if (!id || id !== state.financial_token || !state.financial_version_id) throw new ApiError("CONCURRENT_MODIFICATION");
    const index = Number(a);
    if (!Number.isSafeInteger(index) || index < 0 || !["0", "1"].includes(b ?? "")) throw new ApiError("VALIDATION_FAILED");
    const stored = ((state.financial_files as Row[]) ?? [])[index], field = b === "1" ? "signed_attachment_id" : "attachment_id";
    const attachment = stored?.[field];
    const { card, publicationId } = await version(String(state.financial_version_id));
    if (!attachment || !card.documents.some(d => d[field] === attachment) || !deps.fileStorage) throw new ApiError("NOT_FOUND");
    const file = await publicationFile(deps, deps.fileStorage, actor, publicationId, String(attachment));
    return { text: text("file", { link: safeBlock(`<a href="${esc(file.url)}">${esc(messageButton(deps.templates, lang, "financial.controls", b === "1" ? "signed" : "download"))}</a>`) }), buttons: [[button("back", `/fv ${state.financial_version_id}`)]] };
  }
  if (["/fd", "/financialduties"].includes(command ?? "")) {
    if (bot !== "worker") throw new ApiError("FORBIDDEN");
    if (command === "/financialduties") {
      const offset = page(id), result = await listFinancialObligations(deps, actor, offset), visible = result.items.slice(0, 10);
      return { text: text("duties", { items: safeBlock(visible.map(d => `${esc(period(d))} · ${esc(fmtDate(d.due_at))}`).join("\n")) }), buttons: [...visible.map(d => [button("open", `/fd ${d.id}`, { title: period(d) })]), ...paging("/financialduties", offset, result.has_more || result.items.length > 10), [button("list", "/financial")]] };
    }
    const duty = await getFinancialObligation(deps, actor, String(id));
    return { text: text("duty", { status: text(duty.completed_at ? "duty_done" : "duty_open"), period: period(duty), due: fmtDate(duty.due_at), people: [duty.prepared_name, duty.reviewer_name, duty.publisher_name].join(" · "), channels: duty.missing_channels.join(", ") || text("none") }) + (!duty.completed_at && !duty.missing_channels.length ? `\n${text("check_package")}` : ""), buttons: [[button("duties", "/financialduties")]] };
  }
  throw new ApiError("VALIDATION_FAILED");
}
