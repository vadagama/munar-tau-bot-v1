import type { Row } from "../domains/registry/validation.ts";
import type { TemplateStore } from "../templates/store.ts";
import { message, messageButton, safeBlock } from "../templates/message.ts";
import { type BotReply, btn } from "./keyboard.ts";
import { esc, type Lang } from "./text.ts";
export interface BotInput extends Row {
  token: string;
  command: string;
  object_id: string;
  number: string;
  version: number;
  title: string;
  fields: string[];
  values: string[];
  index: number;
  confirm_command: string;
  cancel_command: string;
  /** Контекстный вопрос шага ввода вместо общего bot.<field>; уже отрендерен. */
  prompt?: string;
}
export function inputFormReply(
  form: BotInput,
  lang: Lang,
  store?: TemplateStore,
): BotReply {
  const button = (id: string, data: string) =>
    btn(messageButton(store, lang, "bot.controls", id), data);
  const field = form.fields[form.index];
  return {
    text: field
      ? form.prompt ?? message(store, lang, `bot.${field}`)
      : message(store, lang, "bot.preview", {
        content: safeBlock(
          [form.title, form.number, ...form.values,...((form.file_names??[]) as string[])].map(esc).join("\n"),
        ),
      }),
    buttons: [
      ...(field==='rating_comment'?[[button('skip',`/rskip ${form.token}`)]]:[]),
      ...(field
        ? []
        : [[button("confirm", `${form.confirm_command} ${form.token}`)]]),
      [button("cancel", form.cancel_command)],
    ],
  };
}
