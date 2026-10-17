import type { Route, RouteContext } from "./handlers.ts";
import { createTask, getTask, listTasks, taskAssignees, transitionTask } from "../../core/src/domains/tasks/service.ts";
import { databaseValidation } from "../../core/src/domains/registry/validation.ts";
const deps = (ctx: RouteContext) => ({ db: ctx.deps.db, audit: ctx.deps.audit });
function route(method: Route["method"], path: string, handler: Route["handler"]): Route {
  return { method, path, action: "task.use", evaluateAs: "effective",
    handler: ctx => databaseValidation(() => handler(ctx)) };
}
export const TASK_ROUTES: Route[] = [
  route("GET", "/v1/requests/:id/task-assignees", async ctx => ({body:{items:await taskAssignees(deps(ctx),ctx.actor,ctx.params.id!)}})),
  route("GET", "/v1/tasks", async ctx => ({body:{items:await listTasks(deps(ctx),ctx.actor,Object.fromEntries(ctx.url.searchParams))}})),
  route("POST", "/v1/tasks", async ctx => ({status:201,body:await createTask(deps(ctx),ctx.actor,ctx.body,ctx.request.headers.get("idempotency-key"))})),
  route("GET", "/v1/tasks/:id", async ctx => ({body:await getTask(deps(ctx),ctx.actor,ctx.params.id!)})),
  route("POST", "/v1/tasks/:id/transitions", async ctx => ({body:await transitionTask(deps(ctx),ctx.actor,ctx.params.id!,ctx.body,ctx.request.headers.get("idempotency-key"))})),
];
