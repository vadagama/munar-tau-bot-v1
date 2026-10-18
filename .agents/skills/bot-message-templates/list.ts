/**
 * Быстрый список и просмотр шаблонов каталога сообщений ботов.
 *
 * Запуск из корня репозитория (Deno 2):
 *   deno run .agents/skills/bot-message-templates/list.ts                 — весь каталог
 *   deno run .agents/skills/bot-message-templates/list.ts --key tasks     — фильтр по key/title/scenario/command
 *   deno run .agents/skills/bot-message-templates/list.ts --section tasks — только один раздел (registration|requests|tasks|incidents|help|errors|notices|common)
 *   deno run .agents/skills/bot-message-templates/list.ts --full <key>    — полное содержимое одного шаблона
 *   ... --json                                                            — машинный вывод
 */
import {
  getTemplate,
  TEMPLATE_CATALOG,
} from "../../../source/core/src/templates/catalog/index.ts";
import type { TemplateDef } from "../../../source/core/src/templates/catalog/types.ts";

const args = Deno.args;
const json = args.includes("--json");
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const key = flag("--key");
const section = flag("--section");
const full = flag("--full");

if (full) {
  const def = getTemplate(full);
  if (!def) {
    console.error(`Шаблон не найден: ${full}`);
    Deno.exit(1);
  }
  if (json) console.log(JSON.stringify(def, null, 2));
  else printFull(def);
} else {
  const needle = key?.toLowerCase();
  const defs = TEMPLATE_CATALOG.filter((d) =>
    (section ? d.section === section : true) &&
    (!needle ||
      d.key.toLowerCase().includes(needle) ||
      d.title.toLowerCase().includes(needle) ||
      (d.scenario ?? "").toLowerCase().includes(needle) ||
      (d.command ?? "").toLowerCase().includes(needle))
  );
  if (json) console.log(JSON.stringify(defs, null, 2));
  else {
    console.log(`Шаблонов: ${defs.length} из ${TEMPLATE_CATALOG.length}`);
    for (const def of defs) printRow(def);
  }
}

function printRow(def: TemplateDef): void {
  const buttons = (def.buttons ?? [])
    .map((b) => `${b.id}="${b.ru}"`)
    .join(", ");
  const flags = [
    def.deprecated ? "deprecated" : "",
    def.scenario ?? "",
    def.command ?? "",
  ].filter(Boolean).join(" · ");
  console.log(
    `${def.key}  [${def.section}]${flags ? `  {${flags}}` : ""}${
      buttons ? `\n    кнопки: ${buttons}` : ""
    }\n    ${def.title}`,
  );
}

function printFull(def: TemplateDef): void {
  console.log(`key: ${def.key}`);
  console.log(`section: ${def.section}`);
  console.log(`title: ${def.title}`);
  console.log(`description: ${def.description}`);
  if (def.scenario) console.log(`scenario: ${def.scenario}`);
  if (def.command) console.log(`command: ${def.command}`);
  if (def.deprecated) console.log("deprecated: да");
  if (def.legacyKeys?.length) {
    console.log(`legacyKeys: ${def.legacyKeys.join(", ")}`);
  }
  if (def.variables.length) {
    console.log("variables:");
    for (const v of def.variables) {
      console.log(`  {${v.name}} — ${v.description} (пример: ${v.example})`);
    }
  }
  console.log("--- ru ---");
  console.log(def.ru);
  console.log("--- kk ---");
  console.log(def.kk);
  if (def.buttons?.length) {
    console.log("buttons:");
    for (const b of def.buttons) {
      const vars = b.variables?.length
        ? ` vars: ${b.variables.map((v) => `{${v.name}}`).join(", ")}`
        : "";
      console.log(`  ${b.id}: ru="${b.ru}" kk="${b.kk}"${vars}`);
    }
  }
  if (def.examples?.length) {
    console.log("examples:");
    for (const e of def.examples) {
      console.log(`  [${e.id}] ${e.title}`);
      const rows = e.buttons ?? [];
      if (rows.length) {
        console.log(
          "    кнопки: " +
            rows.map((row) => row.map((b) => b.id).join(" | ")).join(" // "),
        );
      }
    }
  }
}
