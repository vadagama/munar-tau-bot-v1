import type { Route, RouteContext } from "./handlers.ts";
import {
  listRegistry,
  mutateRegistry,
  recordAudit,
  type RegistryEntity,
} from "../../core/src/domains/registry/service.ts";
import {
  uploadImport,
  inspectImport,
  commitImport,
  type ImportIssue,
} from "../../core/src/domains/registry/import.ts";
import {
  decodeWorkbook,
  encodeWorkbook,
  toBase64,
  fromBase64,
  type ImportPayload,
} from "../../core/src/domains/registry/workbook.ts";
import { registryScope } from "../../core/src/domains/registry/access.ts";
import {
  recoverTelegram,
  submitRegistration,
  listRegistrations,
  editRegistration,
  reviewRegistration,
  createInvite,
  acceptInvite,
} from "../../core/src/domains/registrations/service.ts";
import { ApiError } from "../../core/src/errors/api.ts";
import {
  databaseValidation,
  jsonValue,
  type Row,
  text,
} from "../../core/src/domains/registry/validation.ts";
import {
  addRuleHours,
  type RuleParams,
} from "../../core/src/domains/registry/time.ts";
const deps = (ctx: RouteContext) => ({
  db: ctx.deps.db,
  audit: ctx.deps.audit,
});
const file = (bytes: Uint8Array, name: string) => ({
  body: {
    filename: name,
    content_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data_base64: toBase64(bytes),
  },
});

function exportRegistry(ctx: RouteContext) {
  registryScope(ctx.actor, true);
  const exportActor = {
    ...ctx.actor,
    assignments: ctx.actor.assignments.filter(
      (a) =>
        a.role === "chairman" ||
        (a.role === "administrator" && a.registryExportRights),
    ),
  };
  return ctx.deps.db.transaction(async (exec) => {
    const d = {
      db: { ...ctx.deps.db, query: exec.query.bind(exec) },
      audit: ctx.deps.audit,
    };
    const buildings = await listRegistry(d, exportActor, "buildings");
    const premises = await listRegistry(d, exportActor, "premises");
    const persons = await listRegistry(d, exportActor, "persons");
    const connections = await listRegistry(d, exportActor, "connections");
    const payload: ImportPayload = {
      buildings: buildings.map((r) => ({
        ...r,
        key: r.id,
        house_keys: (typeof r.house_ids === "string"
          ? JSON.parse(r.house_ids)
          : (r.house_ids as string[])
        ).join(","),
      })),
      premises: premises.map((r) => ({
        ...r,
        key: r.id,
        building_key: r.building_id,
      })),
      persons: persons.map((r) => ({ ...r, key: r.id })),
      connections: connections.map((r) => ({
        ...r,
        key: r.id,
        person_key: r.person_id,
        premises_key: r.premises_id,
      })),
    };
    const bytes = await encodeWorkbook(payload);
    await recordAudit(
      deps(ctx),
      exec,
      ctx.actor,
      "registry.export",
      "registry",
      crypto.randomUUID(),
      buildings.map((b) => String(b.id)),
      null,
      { persons: persons.length, premises: premises.length },
    );
    return file(bytes, "registry.xlsx");
  });
}
const routes: Route[] = [];
for (const entity of [
  "buildings",
  "persons",
  "premises",
  "connections",
] as RegistryEntity[]) {
  routes.push({
    method: "GET",
    path: `/v1/registry/${entity}`,
    action: "registry.read",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: { items: await listRegistry(deps(ctx), ctx.actor, entity) },
    }),
  });
  routes.push({
    method: "POST",
    path: `/v1/registry/${entity}`,
    action: "registry.write",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      status: 201,
      body: await mutateRegistry(deps(ctx), ctx.actor, entity, ctx.body),
    }),
  });
  routes.push({
    method: "PATCH",
    path: `/v1/registry/${entity}/:id`,
    action: "registry.write",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await mutateRegistry(
        deps(ctx),
        ctx.actor,
        entity,
        ctx.body,
        ctx.params.id,
      ),
    }),
  });
}
routes.push(
  {
    method: "GET",
    path: "/v1/registry/notification-failures",
    action: "registry.read",
    evaluateAs: "effective",
    handler: async (ctx) => {
      const scope = registryScope(ctx.actor);
      const items = await ctx.deps.db.query<Row>(
        `select distinct on(n.id) n.id,n.last_error,n.attempts,n.created_at,r.id as registration_id
      from notification n join registration r on r.telegram_user_id=n.telegram_user_id join premises p on p.id=r.premises_id
      where n.state='failed' and r.is_test=$2 and ($1::uuid[] is null or p.building_id=any($1::uuid[])) order by n.id,r.created_at desc`,
        [scope, ctx.actor.person.isTest],
      );
      return { body: { items } };
    },
  },
  {
    method: "GET",
    path: "/v1/registrations/invites",
    action: "registry.read",
    evaluateAs: "effective",
    handler: async (ctx) => {
      const scope = registryScope(ctx.actor);
      const items = await ctx.deps.db.query<Row>(
        `select i.id,i.created_at,i.expires_at,i.status,i.role,p.kind,p.number,b.code as building_code,n.full_name as created_by_name from invite i join premises p on p.id=i.premises_id join building b on b.id=p.building_id join person n on n.id=i.created_by where n.is_test=$2 and ($1::uuid[] is null or p.building_id=any($1::uuid[])) order by i.created_at desc`,
        [scope, ctx.actor.person.isTest],
      );
      return { body: { items } };
    },
  },
  {
    method: "POST",
    path: "/v1/registry/persons/:id/telegram-recovery",
    action: "registry.telegram.recovery",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await recoverTelegram(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
      ),
    }),
  },
  {
    method: "GET",
    path: "/v1/registry/template",
    action: "registry.read",
    evaluateAs: "effective",
    handler: async () => file(await encodeWorkbook(), "registry-template.xlsx"),
  },
  {
    method: "POST",
    path: "/v1/registry/imports",
    action: "registry.write",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      status: 202,
      body: await uploadImport(
        deps(ctx),
        ctx.actor,
        await decodeWorkbook(fromBase64(ctx.body.data_base64)),
      ),
    }),
  },
  {
    method: "GET",
    path: "/v1/registry/imports/:id",
    action: "registry.read",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await inspectImport(deps(ctx), ctx.actor, ctx.params.id!),
    }),
  },
  {
    method: "GET",
    path: "/v1/registry/imports/:id/template-errors",
    action: "registry.read",
    evaluateAs: "effective",
    handler: async (ctx) => {
      const batch = await inspectImport(deps(ctx), ctx.actor, ctx.params.id!);
      const [stored] = await ctx.deps.db.query<Row>(
        "select payload from import_batch where id=$1",
        [batch.id],
      );
      return file(
        await encodeWorkbook(
          jsonValue<ImportPayload>(stored!.payload),
          batch.errors as ImportIssue[],
        ),
        "registry-errors.xlsx",
      );
    },
  },
  {
    method: "POST",
    path: "/v1/registry/imports/:id/commit",
    action: "registry.write",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await commitImport(deps(ctx), ctx.actor, ctx.params.id!),
    }),
  },
  {
    method: "POST",
    path: "/v1/registry/export",
    action: "registry.export",
    evaluateAs: "effective",
    handler: exportRegistry,
  },
  {
    method: "GET",
    path: "/v1/registrations",
    action: "registration.review",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: { items: await listRegistrations(deps(ctx), ctx.actor) },
    }),
  },
  {
    method: "POST",
    path: "/v1/registrations",
    action: "registration.self",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      status: 201,
      body: await submitRegistration(deps(ctx), ctx.actor, ctx.body),
    }),
  },
  {
    method: "PATCH",
    path: "/v1/registrations/:id",
    action: "registration.self",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await editRegistration(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
      ),
    }),
  },
  {
    method: "POST",
    path: "/v1/registrations/invites",
    action: "registration.self",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      status: 201,
      body: await createInvite(deps(ctx), ctx.actor, ctx.body),
    }),
  },
  {
    method: "POST",
    path: "/v1/registrations/invites/:token/accept",
    action: "registration.self",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await acceptInvite(deps(ctx), ctx.actor, ctx.params.token!),
    }),
  },
  {
    method: "POST",
    path: "/v1/registrations/tenant-approval",
    action: "registration.self",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await reviewRegistration(
        deps(ctx),
        ctx.actor,
        text(ctx.body, "registration_id"),
        ctx.body.approve === false ? "reject" : "approve",
        ctx.body,
        true,
      ),
    }),
  },
);
for (const decision of ["approve", "reject", "clarify", "dispute"] as const)
  routes.push({
    method: "POST",
    path: `/v1/registrations/:id/${decision}`,
    action:
      decision === "dispute" ? "registration.self" : "registration.review",
    evaluateAs: "effective",
    handler: async (ctx) => ({
      body: await reviewRegistration(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        decision,
        ctx.body,
        decision === "dispute" &&
          !ctx.actor.assignments.some((a) =>
            ["chairman", "administrator", "deputy"].includes(a.role),
          ),
      ),
    }),
  });
routes.push({
  method: "GET",
  path: "/v1/registry/time-rules",
  action: "registry.rules.read",
  evaluateAs: "effective",
  handler: async (ctx) => ({
    body: {
      items: await ctx.deps.db.query(
        "select r.key,v.* from time_rule r join time_rule_version v on v.rule_id=r.id order by r.key,v.version desc",
      ),
    },
  }),
});
routes.push({
  method: "POST",
  path: "/v1/registry/time-rules/:key",
  action: "registry.rules.edit",
  evaluateAs: "effective",
  handler: (ctx) => {
    const allowed = ctx.actor.assignments.some(
      (a) =>
        a.role === "chairman" ||
        a.role === "tech_admin" ||
        (a.role === "administrator" && a.regulationsRights),
    );
    if (!allowed) throw new ApiError("FORBIDDEN");
    const params = ctx.body.params as RuleParams;
    if (!params || !["calendar", "working"].includes(params.clock))
      throw new ApiError("VALIDATION_FAILED");
    addRuleHours(new Date(), params);
    return ctx.deps.db.transaction(async (exec) => {
      const [rule] = await exec.query<{ id: string }>(
        "select id from time_rule where key=$1 for update",
        [ctx.params.key],
      );
      if (!rule) throw new ApiError("NOT_FOUND");
      const [version] = await exec.query(
        "insert into time_rule_version(rule_id,version,params) select $1,coalesce(max(version),0)+1,$2::jsonb from time_rule_version where rule_id=$1 returning *",
        [rule.id, JSON.stringify(params)],
      );
      await recordAudit(
        deps(ctx),
        exec,
        ctx.actor,
        "registry.rules.edit",
        "time_rule",
        rule.id,
        [],
        null,
        version,
        text(ctx.body, "reason"),
      );
      return { status: 201, body: version };
    });
  },
});
export const REGISTRY_ROUTES: readonly Route[] = routes.map((route) => ({
  ...route,
  handler: (ctx) => databaseValidation(() => route.handler(ctx)),
}));
