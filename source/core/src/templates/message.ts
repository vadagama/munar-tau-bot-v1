import { notificationParts } from "../domains/notifications/text.ts";
import type { Lang } from "../bot/text.ts";
import { esc } from "../bot/text.ts";
import { getTemplate } from "./catalog/index.ts";
import { effectiveText, type TemplateStore } from "./store.ts";
import type { TemplateDef } from "./catalog/types.ts";

const trusted = Symbol("server-rendered-message-block");
export interface SafeBlock {
  readonly [trusted]: true;
  readonly html: string;
}
/** Only server-produced, already escaped markup. Never wrap request input. */
export function safeBlock(html: string): SafeBlock {
  return { [trusted]: true, html };
}
export function renderMessageText(
  text: string,
  vars: Readonly<Record<string, unknown>>,
): string {
  return text.replace(/\{([a-z][a-z0-9_]*)\}/g, (token, name: string) => {
    if (!Object.hasOwn(vars, name)) return token;
    const value = vars[name];
    return value && typeof value === "object" && trusted in value
      ? (value as SafeBlock).html
      : esc(value);
  });
}
export function message(
  store: TemplateStore | undefined,
  lang: Lang,
  key: string,
  vars: Readonly<Record<string, unknown>> = {},
): string {
  const def = getTemplate(key);
  if (!def) throw new Error(`Unknown message: ${key}`);
  return renderMessageText(effectiveText(store, def, lang), vars);
}
export function messageButton(
  store: TemplateStore | undefined,
  lang: Lang,
  key: string,
  id: string,
  vars: Readonly<Record<string, unknown>> = {},
): string {
  const def = getTemplate(key)?.buttons?.find((b) => b.id === id);
  if (!def) throw new Error(`Unknown message button: ${key}/${id}`);
  const text = store?.get(key)?.buttons?.[lang]?.[id] ?? def[lang];
  return text.replace(
    /\{([a-z][a-z0-9_]*)\}/g,
    (token, name: string) =>
      Object.hasOwn(vars, name) ? String(vars[name] ?? "") : token,
  ).slice(0, 64);
}
export function messagePreview(
  store: TemplateStore | undefined,
  def: TemplateDef,
  exampleId?: string,
) {
  const example = def.examples?.find((e) => e.id === exampleId) ??
    def.examples?.[0];
  const result = (lang: Lang) => {
    const vars: Record<string, unknown> = {
      ...Object.fromEntries(def.variables.map((v) => [v.name, v.example])),
      ...example?.[lang],
    };
    for (const name of example?.blocks ?? []) {
      if (name in vars) vars[name] = safeBlock(String(vars[name]));
    }
    const text = message(store, lang, def.key, vars);
    return {
      text,
      parts: notificationParts(text),
      buttons: (example?.buttons ?? []).map((row) =>
        row.map((b) =>
          messageButton(store, lang, def.key, b.id, {
            ...b.vars,
            ...b[`vars_${lang}`],
          })
        )
      ),
    };
  };
  return { ru: result("ru"), kk: result("kk") };
}
