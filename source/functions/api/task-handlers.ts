import { startRequestWork } from "../../core/src/domains/tasks/start-request-work.ts";
import { scheduleView, saveSchedule, retryScheduledJob } from "../../core/src/domains/tasks/schedule.ts";
import {
  linkProblem,
  reportProblem,
} from "../../core/src/domains/tasks/problems.ts";
import {
  listTemplates,
  runTemplate,
  saveTemplate,
  templateVersions,
} from "../../core/src/domains/tasks/templates.ts";
import {
  commonAssignees,
  createCommonWork,
  getCommonWork,
  linkCommonRequest,
  listCommonWorks,
  transitionCommonWork,
  unlinkCommonRequest,
} from "../../core/src/domains/tasks/common.ts";
import {
  listRequestVisits,
  proposeVisit,
  updateVisit,
} from "../../core/src/domains/tasks/visits.ts";
import { submitTaskReport } from "../../core/src/domains/tasks/reports.ts";
import type { Route, RouteContext } from "./handlers.ts";
import {
  createTask,
  getTask,
  listTasks,
  taskAssignees,
  transitionTask,
} from "../../core/src/domains/tasks/service.ts";
import { databaseValidation } from "../../core/src/domains/registry/validation.ts";
const deps = (ctx: RouteContext) => ({
  db: ctx.deps.db,
  audit: ctx.deps.audit,
});
function route(
  method: Route["method"],
  path: string,
  handler: Route["handler"],
): Route {
  return {
    method,
    path,
    action: "task.use",
    evaluateAs: "effective",
    handler: (ctx) => databaseValidation(() => handler(ctx)),
  };
}
export const TASK_ROUTES: Route[] = [
  route("GET","/v1/job-templates/:id/schedule",async ctx=>({body:await scheduleView(deps(ctx),ctx.actor,ctx.params.id!)})),
  route("POST","/v1/job-templates/:id/schedule",async ctx=>({body:await saveSchedule(deps(ctx),ctx.actor,ctx.params.id!,ctx.body)})),
  route("POST","/v1/job-runs/:id/retry",async ctx=>({body:await retryScheduledJob(deps(ctx),ctx.actor,ctx.params.id!)})),
  route(
    "POST",
    "/v1/tasks/:id/problems",
    async (ctx) => ({
      status: 201,
      body: await reportProblem(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  route(
    "POST",
    "/v1/task-problems/:id/link",
    async (ctx) => ({
      body: await linkProblem(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  route(
    "GET",
    "/v1/job-templates",
    async (ctx) => ({
      body: { items: await listTemplates(deps(ctx), ctx.actor) },
    }),
  ),
  route(
    "POST",
    "/v1/job-templates",
    async (ctx) => ({
      status: 201,
      body: await saveTemplate(
        deps(ctx),
        ctx.actor,
        null,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  route(
    "PATCH",
    "/v1/job-templates/:id",
    async (ctx) => ({
      body: await saveTemplate(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  route(
    "GET",
    "/v1/job-templates/:id/versions",
    async (ctx) => ({
      body: {
        items: await templateVersions(deps(ctx), ctx.actor, ctx.params.id!),
      },
    }),
  ),
  route(
    "POST",
    "/v1/job-templates/:id/run",
    async (ctx) => ({
      status: 201,
      body: await runTemplate(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  route(
    "GET",
    "/v1/common-works/:id/task-assignees",
    async (ctx) => ({
      body: {
        items: await commonAssignees(deps(ctx), ctx.actor, ctx.params.id!),
      },
    }),
  ),
  route(
    "GET",
    "/v1/common-works",
    async (ctx) => ({
      body: { items: await listCommonWorks(deps(ctx), ctx.actor) },
    }),
  ),
  route(
    "POST",
    "/v1/common-works",
    async (ctx) => ({
      status: 201,
      body: await createCommonWork(
        deps(ctx),
        ctx.actor,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  route(
    "GET",
    "/v1/common-works/:id",
    async (ctx) => ({
      body: await getCommonWork(deps(ctx), ctx.actor, ctx.params.id!),
    }),
  ),
  route(
    "POST",
    "/v1/common-works/:id/requests",
    async (ctx) => ({
      body: await linkCommonRequest(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  route(
    "DELETE",
    "/v1/common-works/:id/requests",
    async (ctx) => ({
      body: await unlinkCommonRequest(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  route(
    "POST",
    "/v1/common-works/:id/transitions",
    async (ctx) => ({
      body: await transitionCommonWork(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  {
    ...route(
      "GET",
      "/v1/requests/:id/visits",
      async (ctx) => ({
        body: {
          items: await listRequestVisits(deps(ctx), ctx.actor, ctx.params.id!),
        },
      }),
    ),
    action: "request.use",
  },
  route(
    "POST",
    "/v1/visits",
    async (ctx) => ({
      status: 201,
      body: await proposeVisit(
        deps(ctx),
        ctx.actor,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  {
    ...route(
      "PATCH",
      "/v1/visits/:id",
      async (ctx) => ({
        body: await updateVisit(
          deps(ctx),
          ctx.actor,
          ctx.params.id!,
          ctx.body,
          ctx.request.headers.get("idempotency-key"),
        ),
      }),
    ),
    action: "request.use",
  },
  route(
    "POST",
    "/v1/tasks/:id/reports",
    async (ctx) => ({
      status: 201,
      body: await submitTaskReport(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  route(
    "GET",
    "/v1/tasks/:id/reports",
    async (ctx) => ({
      body: {
        items: (await getTask(deps(ctx), ctx.actor, ctx.params.id!)).reports,
      },
    }),
  ),
  route("POST", "/v1/requests/:id/start-work", async (ctx) => ({
    status: 201,
    body: await startRequestWork(deps(ctx), ctx.actor, ctx.params.id!, ctx.body,
      ctx.request.headers.get("idempotency-key")),
  })),
  route(
    "GET",
    "/v1/requests/:id/task-assignees",
    async (ctx) => ({
      body: {
        items: await taskAssignees(deps(ctx), ctx.actor, ctx.params.id!),
      },
    }),
  ),
  route(
    "GET",
    "/v1/tasks",
    async (ctx) => ({
      body: {
        items: await listTasks(
          deps(ctx),
          ctx.actor,
          Object.fromEntries(ctx.url.searchParams),
        ),
      },
    }),
  ),
  route(
    "POST",
    "/v1/tasks",
    async (ctx) => ({
      status: 201,
      body: await createTask(
        deps(ctx),
        ctx.actor,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
  route(
    "GET",
    "/v1/tasks/:id",
    async (ctx) => ({
      body: await getTask(deps(ctx), ctx.actor, ctx.params.id!),
    }),
  ),
  route(
    "POST",
    "/v1/tasks/:id/transitions",
    async (ctx) => ({
      body: await transitionTask(
        deps(ctx),
        ctx.actor,
        ctx.params.id!,
        ctx.body,
        ctx.request.headers.get("idempotency-key"),
      ),
    }),
  ),
];
