import type { Actor } from "../pdp/types.ts";
import { can } from "../pdp/evaluate.ts";
import { ApiError } from "../errors/api.ts";
import type { DbExecutor } from "../db/client.ts";
import { recordAudit, type RegistryDeps } from "../domains/registry/service.ts";
import { content, idempotent } from "../domains/requests/service.ts";
import type { Row } from "../domains/registry/validation.ts";
import { getTemplate, TEMPLATE_CATALOG } from "./catalog/index.ts";
import { renderTemplate, validateTemplate } from "./engine.ts";
export interface TemplateVersion extends Row {
  version: number;
  text_ru: string | null;
  text_kk: string | null;
  use_default: boolean;
  created_at: string;
  reason: string;
  created_by: string;
}
function requireAccess(actor: Actor, edit = false) {
  if (
    actor.person.status !== "active" ||
    !can(actor, edit ? "settings.templates.edit" : "settings.templates.read")
      .allow
  ) throw new ApiError("FORBIDDEN");
}
function definition(key: unknown) {
  const def = typeof key === "string" ? getTemplate(key) : undefined;
  if (!def) throw new ApiError("NOT_FOUND");
  return def;
}
function checkedTexts(key: string, input: Row) {
  const def = definition(key);
  const issues: Record<string, string[]> = {};
  for (const lang of ["ru", "kk"] as const) {
    const value = input[`text_${lang}`];
    const errors = typeof value === "string"
      ? validateTemplate(value, def.variables.map((v) => v.name))
      : ["Текст обязателен"];
    if (errors.length) issues[lang] = errors;
  }
  if (Object.keys(issues).length) {
    throw new ApiError("VALIDATION_FAILED", "Проверьте тексты шаблона", issues);
  }
  return { text_ru: input.text_ru as string, text_kk: input.text_kk as string };
}
export async function listTemplates(exec: DbExecutor, actor: Actor) {
  requireAccess(actor);
  const rows = await exec.query<TemplateVersion & { key: string }>(
    `select t.key,v.* from message_template t join lateral (select * from message_template_version where template_id=t.id order by version desc limit 1) v on true`,
  );
  const active = new Map(rows.map((r) => [r.key, r]));
  return TEMPLATE_CATALOG.map((def) => ({
    ...def,
    default_ru: def.ru,
    default_kk: def.kk,
    overridden: active.has(def.key) && !active.get(def.key)!.use_default,
    active: active.get(def.key) ?? null,
  }));
}
export async function templateVersions(
  exec: DbExecutor,
  actor: Actor,
  key: string,
) {
  requireAccess(actor);
  definition(key);
  return exec.query<TemplateVersion>(
    `select v.*,p.full_name as author from message_template_version v join message_template t on t.id=v.template_id left join person p on p.id=v.created_by where t.key=$1 order by v.version desc`,
    [key],
  );
}
export function previewTemplate(actor: Actor, input: Row) {
  requireAccess(actor);
  const def = definition(input.key);
  const text = checkedTexts(def.key, {
    text_ru: input.text_ru ?? def.ru,
    text_kk: input.text_kk ?? def.kk,
  });
  const vars = input.vars === undefined
    ? Object.fromEntries(def.variables.map((v) => [v.name, v.example]))
    : input.vars;
  if (!vars || typeof vars !== "object" || Array.isArray(vars)) {
    throw new ApiError("VALIDATION_FAILED");
  }
  for (const [name, value] of Object.entries(vars)) {
    if (
      !def.variables.some((v) => v.name === name) ||
      !["string", "number", "boolean"].includes(typeof value) ||
      String(value).length > 4000
    ) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Некорректные примеры переменных",
      );
    }
  }
  return {
    ru: renderTemplate(text.text_ru, vars as Row),
    kk: renderTemplate(text.text_kk, vars as Row),
  };
}
export async function saveVersion(
  deps: RegistryDeps,
  actor: Actor,
  key: string,
  input: Row,
  idempotencyKey: unknown,
) {
  requireAccess(actor, true);
  definition(key);
  return deps.db.transaction((exec) =>
    idempotent(
      exec,
      actor,
      `templates:${key}`,
      idempotencyKey,
      input,
      async () => {
        const reason = content(input.reason, "причина");
        await exec.query(
          "insert into message_template(key) values($1) on conflict(key) do nothing",
          [key],
        );
        const [template] = await exec.query<{ id: string }>(
          "select id from message_template where key=$1 for update",
          [key],
        );
        const [old] = await exec.query<TemplateVersion>(
          "select * from message_template_version where template_id=$1 order by version desc limit 1",
          [template!.id],
        );
        if (
          input.base_version !== undefined &&
          input.base_version !== (old?.version ?? 0)
        ) throw new ApiError("CONCURRENT_MODIFICATION");
        let source = input;
        if (input.rollback_to !== undefined) {
          if (
            !Number.isSafeInteger(input.rollback_to) ||
            Number(input.rollback_to) < 1
          ) throw new ApiError("VALIDATION_FAILED");
          const [previous] = await exec.query<TemplateVersion>(
            "select * from message_template_version where template_id=$1 and version=$2",
            [template!.id, input.rollback_to],
          );
          if (!previous) throw new ApiError("NOT_FOUND");
          source = previous;
        }
        const reset = source.use_default === true;
        const texts = reset
          ? { text_ru: null, text_kk: null }
          : checkedTexts(key, source);
        const [version] = await exec.query<TemplateVersion>(
          "insert into message_template_version(template_id,version,text_ru,text_kk,use_default,reason,created_by) values($1,$2,$3,$4,$5,$6,$7) returning *",
          [
            template!.id,
            (old?.version ?? 0) + 1,
            texts.text_ru,
            texts.text_kk,
            reset,
            reason,
            actor.person.id,
          ],
        );
        await recordAudit(
          deps,
          exec,
          actor,
          "settings.templates.edit",
          "message_template",
          template!.id,
          [],
          old ?? null,
          { ...version, key, rollback_to: input.rollback_to },
          reason,
        );
        return { version: version! };
      },
      async () => {
        requireAccess(actor, true);
      },
    )
  );
}
export const rollbackVersion = saveVersion;
