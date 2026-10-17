import { loadTemplateStore } from "../templates/store.ts";
import { incidentStep } from "./incidents.ts";
import { notificationStep } from "./notifications.ts";
import { taskStep } from "./tasks.ts";
import type { DbExecutor } from "../db/client.ts";
import { registrationScenarios } from "./registration.ts";
import { requestStep } from "./requests.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { ApiError } from "../errors/api.ts";
// Кнопки остаются сахаром Telegram: эмуляция и симулятор видят только текст.
import { replyText } from "./keyboard.ts";
export function botScenarios(deps: RegistryDeps) {
  const scenarios = registrationScenarios(deps);
  for (const id of ["requests","tasks","incidents"]) scenarios.register({
    id,
    description: id === "requests" ? "REQ/SHR/MSG: обращения и переписка" : id === "incidents" ? "EMG/PUB: аварии и публикации" : "WRK: задания исполнителя",
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
      const step = id === "requests"
        ? requestStep
        : id === "incidents"
        ? incidentStep
        : taskStep;
      return replyText(await step({...d, templates: await loadTemplateStore(ctx.executor ?? deps.db)}, String(profile.telegram_user_id), input, ctx.actor));
    },
  });
  scenarios.register({id:"notifications",description:"NTF: настройки уведомлений",run:async(input,ctx)=>{
    if(!ctx.actor?.emulation || !ctx.actor.person.isTest) throw new ApiError("FORBIDDEN");
    const exec=ctx.executor;
    const d=exec ? {...deps,db:{...deps.db,query:exec.query.bind(exec),transaction:<T>(fn:(e:DbExecutor)=>Promise<T>)=>fn(exec)}} : deps;
    return replyText(await notificationStep({...d, templates: await loadTemplateStore(ctx.executor ?? deps.db)},"0",input,ctx.actor));
  }});
  return scenarios;
}
