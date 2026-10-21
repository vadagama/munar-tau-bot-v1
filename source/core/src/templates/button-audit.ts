import { TEMPLATE_CATALOG } from "./catalog/index.ts";
import { effectiveText, type TemplateStore } from "./store.ts";
import { validateMenuLabels } from "../bot/help.ts";
/** Release preflight only: never changes append-only template history. */
export function auditButtonTemplates(store?: TemplateStore) {
  const issues: { key: string; language: string; reason: string }[] = [];
  for (
    const def of TEMPLATE_CATALOG.filter((d) =>
      !d.deprecated && d.section !== "notices"
    )
  ) {
    for (const language of ["ru", "kk"] as const) {
      const context = effectiveText(store, def, language)
        .replace(/<[^>]+>/g, " ")
        .replace(/https?:\/\/[^\s<>"']+/g, " ");
      if (/(^|[^a-z0-9_])\/[a-z][a-z0-9_]{0,31}(?![a-z0-9_])/i.test(context)) {
        issues.push({
          key: def.key,
          language,
          reason: "Команда в основном тексте",
        });
      }
    }
  }
  for (const reason of validateMenuLabels(store)) {
    issues.push({ key: "menu", language: "ru/kk", reason });
  }
  return issues;
}
