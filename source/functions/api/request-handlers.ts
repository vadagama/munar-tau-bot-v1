import type { Route, RouteContext } from "./handlers.ts";
import { requireRequest } from "../../core/src/domains/requests/access.ts";
import { ApiError } from "../../core/src/errors/api.ts";
import {
  content,
  createRequest,
  deleteDraft,
  editRequest,
  getRequest,
  listRequests,
  transitionRequest,
} from "../../core/src/domains/requests/service.ts";
import {
  addMessage,
  rateRequest,
  restrictMessage,
  shareRequest,
} from "../../core/src/domains/requests/messages.ts";
import {
  completeFile,
  FILE_TYPES,
  fileUrl,
  MAX_FILE_BYTES,
  prepareFile,
  retryFile,
  uploadFile,
} from "../../core/src/domains/requests/files.ts";
import { databaseValidation } from "../../core/src/domains/registry/validation.ts";
import { recordAudit } from "../../core/src/domains/registry/service.ts";
const deps = (ctx: RouteContext) => ({
  db: ctx.deps.db,
  audit: ctx.deps.audit,
});
const key = (ctx: RouteContext) =>
  ctx.request.headers.get("idempotency-key") ?? undefined;
const storage = (ctx: RouteContext) => {
  if (!ctx.deps.storage) {
    throw new ApiError("INTERNAL", "Хранилище не настроено");
  }
  return ctx.deps.storage;
};
function route(
  method: Route["method"],
  path: string,
  handler: Route["handler"],
  action: Route["action"] = "request.use",
): Route {
  return {
    method,
    path,
    action,
    evaluateAs: "effective",
    handler: (ctx) => databaseValidation(() => handler(ctx)),
  };
}
export const REQUEST_ROUTES: Route[] = [
  route("GET", "/v1/requests/context", async (ctx) => ({
    body: {
      premises: await ctx.deps.db.query(
        `select p.id,p.number,p.kind,p.building_id,b.name building_name from connection c join premises p on p.id=c.premises_id join building b on b.id=p.building_id where c.person_id=$1 and c.status='active' and p.is_test=$2 and p.status='active' order by b.name,p.number`,
        [ctx.actor.person.id, ctx.actor.person.isTest],
      ),
      staff: await ctx.deps.db.query(
        `select distinct n.id,n.full_name from person n join staff_assignment a on a.person_id=n.id where n.is_test=$1 and n.status='active' and a.status='active' and (exists(select 1 from connection c where c.person_id=$2 and c.status='active') or $3::boolean) and a.role in ('chairman','administrator','deputy','executor','duty') and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())`,
        [
          ctx.actor.person.isTest,
          ctx.actor.person.id,
          ctx.actor.assignments.some((a) =>
            ["chairman", "administrator", "deputy"].includes(a.role)
          ),
        ],
      ),
      buildings: await ctx.deps.db.query(
        "select id,name,code from building order by code",
      ),
    },
  })),
  route("GET", "/v1/requests/:id/share-candidates", async (ctx) => {
    const r = await requireRequest(
      ctx.deps.db,
      ctx.actor,
      ctx.params.id!,
      "request.author",
    );
    return {
      body: {
        items: r.premises_id
          ? await ctx.deps.db.query(
            `select c.person_id,n.full_name from connection c join person n on n.id=c.person_id join premises room on room.id=c.premises_id where room.kind='apartment' and c.premises_id=$1 and c.status='active' and c.person_id<>$2 and n.is_test=$3 and exists(select 1 from profile p where p.person_id=n.id and p.archived_at is null)`,
            [r.premises_id, ctx.actor.person.id, r.is_test],
          )
          : [],
      },
    };
  }),
  route("POST", "/v1/requests/search", async (ctx) => {
    const items = await listRequests(deps(ctx), ctx.actor, ctx.body);
    const offset = ctx.body.cursor ? Number(atob(String(ctx.body.cursor))) : 0;
    return {
      body: {
        items,
        next_cursor: items.length === 100 ? btoa(String(offset + 100)) : null,
      },
    };
  }),
  route("GET", "/v1/requests", async (ctx) => {
    const items = await listRequests(
      deps(ctx),
      ctx.actor,
      Object.fromEntries(ctx.url.searchParams),
    );
    const offset = ctx.url.searchParams.get("cursor")
      ? Number(atob(ctx.url.searchParams.get("cursor")!))
      : 0;
    return {
      body: {
        items,
        next_cursor: items.length === 100 ? btoa(String(offset + 100)) : null,
      },
    };
  }),
  route(
    "POST",
    "/v1/requests",
    async (ctx) => ({
      status: 201,
      body: await createRequest(deps(ctx), ctx.actor, ctx.body, key(ctx)),
    }),
  ),
  route(
    "GET",
    "/v1/requests/:id",
    async (ctx) => ({
      body: await getRequest(deps(ctx), ctx.actor, ctx.params.id!),
    }),
  ),
  route(
    "PATCH",
    "/v1/requests/:id",
    async (ctx) => ({
      body: await editRequest(deps(ctx), ctx.actor, ctx.params.id!, ctx.body),
    }),
  ),
  route(
    "DELETE",
    "/v1/requests/:id/draft",
    async (ctx) => ({
      body: await deleteDraft(deps(ctx), ctx.actor, ctx.params.id!),
    }),
  ),
  route(
    "POST",
    "/v1/requests/:id/transitions",
    async (ctx) => ({
      body: await transitionRequest(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        key(ctx),
      ),
    }),
  ),
  route("GET", "/v1/requests/:id/messages", async (ctx) => {
    const card = await getRequest(deps(ctx), ctx.actor, ctx.params.id!);
    const channel = ctx.url.searchParams.get("channel") ?? "resident";
    if (channel === "internal" && !card.can_manage) {
      throw new ApiError("FORBIDDEN");
    }
    return {
      body: {
        items: (card.messages as { channel: string }[]).filter((m) =>
          m.channel === channel
        ),
      },
    };
  }),
  route(
    "POST",
    "/v1/requests/:id/messages",
    async (ctx) => ({
      status: 201,
      body: await addMessage(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        key(ctx),
      ),
    }),
  ),
  route(
    "POST",
    "/v1/requests/:id/messages/:message/restrict",
    async (ctx) => ({
      body: await restrictMessage(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.params.message!,
        ctx.body,
      ),
    }),
  ),
  route(
    "POST",
    "/v1/requests/:id/participants",
    async (ctx) => ({
      body: await shareRequest(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        content(ctx.body.person_id),
      ),
    }),
  ),
  route(
    "DELETE",
    "/v1/requests/:id/participants/:person",
    async (ctx) => ({
      body: await shareRequest(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.params.person!,
        true,
      ),
    }),
  ),
  route(
    "POST",
    "/v1/requests/:id/rating",
    async (ctx) => ({
      body: await rateRequest(deps(ctx), ctx.actor, ctx.params.id!, ctx.body),
    }),
  ),
  route(
    "PATCH",
    "/v1/requests/:id/rating",
    async (ctx) => ({
      body: await rateRequest(deps(ctx), ctx.actor, ctx.params.id!, ctx.body),
    }),
  ),
  route(
    "GET",
    "/v1/requests/:id/log",
    async (ctx) => ({
      body: {
        items: (await getRequest(deps(ctx), ctx.actor, ctx.params.id!)).log,
      },
    }),
  ),
  route(
    "GET",
    "/v1/file-policy",
    async (ctx) => ({
      body:
        (await ctx.deps.db.query("select * from file_policy where singleton"))[
          0
        ],
    }),
  ),
  route("PATCH", "/v1/file-policy", async (ctx) => {
    const p = ctx.body;
    if (
      !Number.isInteger(p.max_bytes) || Number(p.max_bytes) < 1 ||
      Number(p.max_bytes) > MAX_FILE_BYTES ||
      !Number.isInteger(p.max_per_message) || Number(p.max_per_message) < 1 ||
      Number(p.max_per_message) > 10 || !Array.isArray(p.extensions) ||
      !p.extensions.length || p.extensions.some((e) =>
        typeof e !== "string" || !FILE_TYPES[e]
      )
    ) throw new ApiError("VALIDATION_FAILED");
    return {
      body: await ctx.deps.db.transaction(async (exec) => {
        const [row] = await exec.query(
          "update file_policy set max_bytes=$1,max_per_message=$2,extensions=$3::text[] where singleton returning *",
          [p.max_bytes, p.max_per_message, p.extensions],
        );
        await recordAudit(
          deps(ctx),
          exec,
          ctx.actor,
          "request.file_policy_changed",
          "file_policy",
          ctx.actor.person.id,
          [],
          null,
          row,
        );
        return row;
      }),
    };
  }, "request.category.edit"),
  route(
    "GET",
    "/v1/request-categories",
    async (ctx) => ({
      body: {
        items: await ctx.deps.db.query(
          "select * from request_category order by sort,name_ru",
        ),
      },
    }),
  ),
  route("POST", "/v1/request-categories", async (ctx) => {
    const id = crypto.randomUUID();
    const item = await ctx.deps.db.transaction(async (exec) => {
      const [r] = await exec.query(
        "insert into request_category(id,name_ru,name_kk,sort) values ($1,$2,$3,$4) returning *",
        [
          id,
          content(ctx.body.name_ru),
          content(ctx.body.name_kk),
          ctx.body.sort ?? 0,
        ],
      );
      await recordAudit(
        deps(ctx),
        exec,
        ctx.actor,
        "request.category_created",
        "request_category",
        id,
        [],
        null,
        r,
      );
      return r;
    });
    return { body: item, status: 201 };
  }, "request.category.edit"),
  route(
    "PATCH",
    "/v1/request-categories/:id",
    async (ctx) => ({
      body: await ctx.deps.db.transaction(async (exec) => {
        const [row] = await exec.query(
          "update request_category set name_ru=$2,name_kk=$3,sort=$4,active=$5 where id=$1 returning *",
          [
            ctx.params.id,
            content(ctx.body.name_ru),
            content(ctx.body.name_kk),
            ctx.body.sort ?? 0,
            ctx.body.active !== false,
          ],
        );
        if (!row) throw new ApiError("NOT_FOUND");
        await recordAudit(
          deps(ctx),
          exec,
          ctx.actor,
          "request.category_changed",
          "request_category",
          ctx.params.id!,
          [],
          null,
          row,
        );
        return row;
      }),
    }),
    "request.category.edit",
  ),
  route("POST", "/v1/files/upload-url", async (ctx) => {
    const result = await prepareFile(deps(ctx), ctx.actor, ctx.body);
    const url = new URL(ctx.url);
    url.pathname = url.pathname.replace(
      /\/v1\/files\/upload-url$/,
      String(result.upload_path),
    );
    return { body: { ...result, upload_url: url.toString() } };
  }),
  route(
    "POST",
    "/v1/files/:id/retry",
    async (ctx) => ({
      body: await retryFile(deps(ctx), ctx.actor, ctx.params.id!),
    }),
  ),
  route("POST", "/v1/files/:id/upload", async (ctx) => {
    const length = Number(ctx.request.headers.get("content-length"));
    if (length > MAX_FILE_BYTES) throw new ApiError("FILE_LIMIT");
    const reader = ctx.request.body?.getReader();
    if (!reader) throw new ApiError("VALIDATION_FAILED");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > MAX_FILE_BYTES) throw new ApiError("FILE_LIMIT");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    return {
      body: await uploadFile(
        deps(ctx),
        storage(ctx),
        ctx.actor,
        ctx.params.id!,
        bytes,
      ),
    };
  }),
  route(
    "POST",
    "/v1/files/:id/complete",
    async (ctx) => ({
      body: await completeFile(
        deps(ctx),
        storage(ctx),
        ctx.actor,
        ctx.params.id!,
      ),
    }),
  ),
  route(
    "GET",
    "/v1/files/:id/url",
    async (ctx) => ({
      body: await fileUrl(deps(ctx), storage(ctx), ctx.actor, ctx.params.id!),
    }),
  ),
];
