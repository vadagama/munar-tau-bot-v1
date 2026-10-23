import { loadDialog,saveDialog } from "./dialog.ts";
import { documentStep } from "./documents.ts";
import { navigationReply } from "./navigation.ts";
import { staffRequestStep } from "./staff-requests.ts";
import { workerHelp } from "./help.ts";
import { withSimulatorMenu } from "./simulator-menu.ts";
import { loadTemplateStore } from "../templates/store.ts";
import { incidentStep } from "./incidents.ts";
import { notificationStep } from "./notifications.ts";
import { taskStep } from "./tasks.ts";
import type { DbExecutor } from "../db/client.ts";
import { registrationScenarios } from "./registration.ts";
import { requestStep } from "./requests.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { ApiError } from "../errors/api.ts";
export function botScenarios(deps: RegistryDeps) {
  const scenarios = registrationScenarios(deps);
  for (const id of ["requests","tasks","incidents","staff-requests","documents"]) scenarios.register({
    id,
    description: id === "documents" ? "DOC/WRK: документы и обязанности" : id === "requests" ? "REQ/SHR/MSG: обращения и переписка" : id === "incidents" ? "EMG/PUB: аварии и публикации" : "WRK: задания исполнителя",
    run: async (input, ctx) => {
      if (
        !ctx.actor?.emulation || !ctx.actor.person.isTest
      ) throw new ApiError("FORBIDDEN");
      const [profile] = await (ctx.executor ?? deps.db).query<
        { telegram_user_id: string }
      >("select telegram_user_id from profile where id=$1 and is_test=true", [
        ctx.profileId,
      ]);
      if (!profile) throw new ApiError("FORBIDDEN");
      const exec = ctx.executor;
      const d = exec
        ? {
          ...deps,
          db: {
            ...deps.db,
            query: exec.query.bind(exec),
            transaction: <T>(fn: (e: DbExecutor) => Promise<T>) => fn(exec),
          },
        }
        : deps;
      const step = id === "documents" ? documentStep : id === "staff-requests" ? staffRequestStep : id === "requests"
        ? requestStep
        : id === "incidents"
        ? incidentStep
        : taskStep;
      d.bot = ["tasks","staff-requests"].includes(id) ? "worker" : ctx.bot ?? "resident";
      const templates = await loadTemplateStore(ctx.executor ?? deps.db);
      if(id==='tasks'&&['/help','/start','/cancel'].includes(input.trim())){
        await loadDialog(d.db,String(profile.telegram_user_id),'worker',ctx.actor.profile.id,ctx.actor.emulation.sessionId);
        await saveDialog(d.db,String(profile.telegram_user_id),'worker',{});
      }
      const reply = id === "tasks" && ["/help", "/start", "/cancel"].includes(input.trim())
        ? workerHelp(ctx.actor.profile.language, templates)
        : await step({...d, templates}, String(profile.telegram_user_id), input, ctx.actor);
      return withSimulatorMenu(navigationReply(reply,id,ctx.actor.profile.language,templates,input), id === "documents" && d.bot === "worker" ? "tasks" : id, ctx.actor.profile.language, templates);
    },
  });
  scenarios.register({id:"notifications",description:"NTF: настройки уведомлений",run:async(input,ctx)=>{
    if(!ctx.actor?.emulation || !ctx.actor.person.isTest) throw new ApiError("FORBIDDEN");
    const exec=ctx.executor;
    const d=exec ? {...deps,db:{...deps.db,query:exec.query.bind(exec),transaction:<T>(fn:(e:DbExecutor)=>Promise<T>)=>fn(exec)}} : deps;
    const templates = await loadTemplateStore(ctx.executor ?? deps.db);
    const [profile]=await d.db.query<{telegram_user_id:string}>("select telegram_user_id from profile where id=$1 and is_test=true",[ctx.profileId]);
    if(!profile)throw new ApiError('FORBIDDEN');
    const reply = await notificationStep({...d, templates,bot:ctx.bot},String(profile.telegram_user_id),input,ctx.actor);
    return withSimulatorMenu(reply, "notifications", ctx.actor.profile.language, templates);
  }});
  return scenarios;
}
