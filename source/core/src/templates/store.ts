import type { DbExecutor } from "../db/client.ts";
import type { Lang } from "../bot/text.ts";
import type { TemplateDef } from "./catalog/types.ts";
import { getTemplate } from "./catalog/index.ts";
import { renderTemplate, validateTemplate } from "./engine.ts";
export interface TemplateButtons {
  ru: Record<string, string>;
  kk: Record<string, string>;
}
export interface TemplateOverride {
  ru: string;
  kk: string;
  useDefault?: boolean;
  buttons?: TemplateButtons;
  /** Previous reply-keyboard labels stay valid after renaming or resetting a menu. */
  historicalButtons?: readonly TemplateButtons[];
}
export type TemplateStore = ReadonlyMap<string, TemplateOverride>;
export const EMPTY_TEMPLATE_STORE: TemplateStore = new Map();
export async function loadTemplateStore(
  exec: DbExecutor,
): Promise<TemplateStore> {
  const rows = await exec.query<
    {
      key: string;
      text_ru: string;
      text_kk: string;
      use_default: boolean;
      buttons_ru?: Record<string, string>;
      buttons_kk?: Record<string, string>;
      historical_buttons?: TemplateButtons[];
    }
  >(`select t.key,v.text_ru,v.text_kk,v.use_default,v.buttons_ru,v.buttons_kk,
case when t.key in ('help.welcome_text','help.registration_help','help.worker_help') then
 (select coalesce(jsonb_agg(distinct jsonb_build_object('ru',coalesce(h.buttons_ru,'{}'::jsonb),'kk',coalesce(h.buttons_kk,'{}'::jsonb))),'[]'::jsonb)
  from message_template_version h where h.template_id=t.id and not h.use_default)
else '[]'::jsonb end as historical_buttons
from message_template t join lateral (select text_ru,text_kk,use_default,buttons_ru,buttons_kk from message_template_version where template_id=t.id order by version desc limit 1) v on true`);
  return new Map(
    rows.filter((r) => getTemplate(r.key)).map(
      (r) => [r.key, {
        ru: r.use_default ? getTemplate(r.key)!.ru : r.text_ru,
        kk: r.use_default ? getTemplate(r.key)!.kk : r.text_kk,
        useDefault: r.use_default,
        buttons: { ru: r.buttons_ru ?? {}, kk: r.buttons_kk ?? {} },
        historicalButtons: r.historical_buttons ?? [],
      }],
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
  return renderTemplate(effectiveText(store, def, lang), vars);
}

/** Project an old fragment only when its default occurs literally and unambiguously. */
export function legacyProjection(
  store: TemplateStore | undefined,
  def: TemplateDef,
  lang: Lang,
) {
  let text = def[lang];
  const unresolved: string[] = [];
  const changes: { key: string; start: number; end: number; text: string }[] =
    [];
  for (const key of def.legacyKeys ?? []) {
    const old = getTemplate(key), override = store?.get(key);
    if (!old || !override || override.useDefault) continue;
    const literal = old[lang].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])`,
      "gu",
    );
    const matches = old[lang] ? [...def[lang].matchAll(pattern)] : [];
    const candidate = def[lang].replace(pattern, () => override[lang]);
    if (
      matches.length === 1 &&
      !validateTemplate(candidate, def.variables.map((v) => v.name)).length
    ) {
      const start = matches[0]!.index!;
      changes.push({
        key,
        start,
        end: start + old[lang].length,
        text: override[lang],
      });
    } else unresolved.push(key);
  }
  const safeChanges = changes.filter((change) => {
    if (
      changes.some((other) =>
        other !== change && other.start < change.end && change.start < other.end
      )
    ) {
      unresolved.push(change.key);
      return false;
    }
    return true;
  });
  for (const change of safeChanges.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, change.start) + change.text + text.slice(change.end);
  }
  return { text, unresolved };
}
export function effectiveText(
  store: TemplateStore | undefined,
  def: TemplateDef,
  lang: Lang,
): string {
  const override = store?.get(def.key);
  return override
    ? (override.useDefault ? def[lang] : override[lang])
    : legacyProjection(store, def, lang).text;
}
