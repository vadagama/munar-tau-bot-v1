import { ApiError } from "../errors/api.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { answerPoll, getPoll } from "../domains/polls/service.ts";
import { listPolls } from "../domains/polls/list.ts";
import { getPollResults } from "../domains/polls/transitions.ts";
import { actorForTelegram } from "./registration.ts";
import { loadDialog, saveDialog } from "./dialog.ts";
import { btn, type BotReply, type InlineButton } from "./keyboard.ts";
import { esc, fmtDate } from "./text.ts";
import { message, messageButton, safeBlock } from "../templates/message.ts";

export const POLL_COMMANDS = ["/polls", "/poll", "/po", "/pc"];
const nonce = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);

/** Личная форма привязана к каналу, персоне, сеансу, карточке и версии ответа. */
export async function pollStep(deps: RegistryDeps, telegram: string, input: string, providedActor?: Actor): Promise<BotReply> {
  const actor = providedActor ?? await actorForTelegram(deps, telegram);
  if (!actor) throw new ApiError("FORBIDDEN");
  const bot = deps.bot ?? "resident", lang = actor.profile.language;
  const state = await loadDialog(deps.db, telegram, bot, actor.profile.id, actor.emulation?.sessionId ?? null, "polls");
  const text = (key: string, vars: Row = {}) => message(deps.templates, lang, `polls.${key}`, vars);
  const button = (key: string, data: string, vars: Row = {}) => btn(messageButton(deps.templates, lang, "polls.controls", key, vars), data);
  const save = () => saveDialog(deps.db, telegram, bot, state);
  const [command, id, indexText] = input.trim().split(/\s+/);
  if (command === "/start" && id?.startsWith("poll_")) return pollStep(deps, telegram, `/poll ${id.slice(5)}`, actor);
  if (command === "/polls") {
    for (const key of Object.keys(state)) if (key !== "scenario") delete state[key];
    await save();
    const offset = Number(id ?? 0);
    const result = await listPolls(deps, actor, { offset, limit: 10 });
    const paging: InlineButton[] = [];
    if (offset) paging.push(button("prev", `/polls ${Math.max(0, offset - 10)}`));
    if (result.has_more) paging.push(button("next", `/polls ${offset + 10}`));
    return { text: text(result.items.length ? "list" : "empty"), buttons: [
      ...result.items.map(p => [button("open", `/poll ${p.id}`, { question: p.question })]),
      ...(paging.length ? [paging] : []),
    ] };
  }
  if (command === "/pc" || command === "/po") {
    if (bot !== "resident") throw new ApiError("FORBIDDEN");
    if (!id || id !== state.poll_token || !state.poll_id) throw new ApiError("CONCURRENT_MODIFICATION");
    const card = await getPoll(deps, actor, String(state.poll_id));
    if (!card.can_answer) throw new ApiError("NOT_FOUND");
    if (card.version !== state.poll_version || (card.own_answer?.version ?? 0) !== state.poll_answer_version) throw new ApiError("CONCURRENT_MODIFICATION");
    const index = Number(indexText);
    if (!indexText || !Number.isInteger(index) || index < 0 || !card.options[index]) throw new ApiError("VALIDATION_FAILED");
    if (command === "/po") {
      state.poll_choice_index = index; await save();
      return { text: text("preview", { choice: card.options[index]!.label }), buttons: [
        [button("confirm", `/pc ${state.poll_token} ${index}`)], [button("back", `/poll ${card.id}`)],
      ] };
    }
    if (card.options[index]!.label.length > 64 && state.poll_choice_index !== index) throw new ApiError("CONCURRENT_MODIFICATION");
    await answerPoll(deps, actor, card.id, { option_key: card.options[index]!.key, expected_version: state.poll_answer_version }, `poll-form:${id}`);
    // Replay возвращает прежний снимок; новый GET повторяет доступ и included.
    return pollStep(deps, telegram, `/poll ${card.id}`, actor);
  }
  if (command !== "/poll" || !id) return { text: text("buttons_only"), buttons: [[button("list", "/polls")]] };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApiError("VALIDATION_FAILED");
  const card = await getPoll(deps, actor, id.toLowerCase());
  delete state.poll_choice_index;
  state.poll_id = card.id; state.poll_token = nonce(); state.poll_version = card.version;
  state.poll_answer_version = card.own_answer?.version ?? 0;
  await save();
  let body = text("card", { question: card.question, deadline: fmtDate(card.closes_at), status: text(`state.${card.state}`) });
  const own = card.own_answer;
  if (own && card.state !== "canceled") body += "\n" + (own.included
    ? text(card.can_answer && bot === "resident" ? "own" : "own_final", { choice: card.options.find(o => o.key === own.option_key)?.label ?? "—" })
    : text("excluded"));
  const rows: InlineButton[][] = [];
  if (card.state === "canceled") body += "\n" + text("canceled", { reason: card.cancel_reason });
  else {
    if (bot === "resident" && card.can_answer) {
      rows.push(...card.options.map((o, index) => [o.label.length > 64
        ? button("long_option", `/po ${state.poll_token} ${index}`, { number: index + 1, label: o.label })
        : button("option", `/pc ${state.poll_token} ${index}`, { label: o.label })]));
    } else if (card.state === "open" && card.deadline_passed) body += "\n" + text("pending_result");
    else if (card.state === "open" && bot === "resident") body += "\n" + text("no_access");
    if (card.state === "closed" && card.can_results) {
      const result = await getPollResults(deps, actor, card.id);
      body += "\n" + text("result", { count: result.participants_count, items: safeBlock(result.distribution.map(d =>
        `${esc(card.options.find(o => o.key === d.option_key)?.label ?? "—")}: ${esc(d.count)}`).join("\n")) });
    }
  }
  rows.push([button("refresh", `/poll ${card.id}`), button("list", "/polls")]);
  return { text: body, buttons: rows };
}
