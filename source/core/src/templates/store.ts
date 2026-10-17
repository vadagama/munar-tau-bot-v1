import type { DbExecutor } from "../db/client.ts";
import type { Lang } from "../bot/text.ts";
import { getTemplate } from "./catalog/index.ts";
import { renderTemplate } from "./engine.ts";
export type TemplateStore = ReadonlyMap<string, { ru: string; kk: string }>;
export const EMPTY_TEMPLATE_STORE: TemplateStore = new Map();
export async function loadTemplateStore(
  exec: DbExecutor,
): Promise<TemplateStore> {
  const rows = await exec.query<
    { key: string; text_ru: string; text_kk: string; use_default: boolean }
  >(`select t.key,v.text_ru,v.text_kk,v.use_default from message_template t join lateral (select text_ru,text_kk,use_default from message_template_version where template_id=t.id order by version desc limit 1) v on true`);
  return new Map(
    rows.filter((r) => !r.use_default && getTemplate(r.key)).map(
      (r) => [r.key, { ru: r.text_ru, kk: r.text_kk }],
    ),
  );
}
export function t(
  store: TemplateStore | undefined,
  lang: Lang,
  key: string,
  vars: Readonly<Record<string, unknown>> = {},
): string {
  const def = getTemplate(key);
  if (!def) {
    return lang === "kk"
      ? "Хабарлама қолжетімсіз. /help"
      : "Сообщение недоступно. /help";
  }
  return renderTemplate(store?.get(key)?.[lang] ?? def[lang], vars);
}
