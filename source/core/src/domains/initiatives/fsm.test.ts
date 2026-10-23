import { expect,it } from "vitest";
import { publicationTransition, stageTransition } from "./fsm.ts";
it("публикация и рассмотрение независимы; непубличная подача получает только одно решение",()=>{
  expect(publicationTransition("submitted","publish")).toBe("published");
  expect(publicationTransition("submitted","reject")).toBe("rejected");
  expect(()=>publicationTransition("published","publish")).toThrow();
  expect(()=>publicationTransition("rejected","publish")).toThrow();
});
it("IDEA-03 проходит согласованные этапы без пропуска планирования",()=>{
  expect(stageTransition("collecting","assessing")).toBe("assessing");
  expect(stageTransition("assessing","planned")).toBe("planned");
  expect(stageTransition("planned","implementing")).toBe("implementing");
  expect(stageTransition("implementing","completed")).toBe("completed");
  expect(()=>stageTransition("collecting","implementing")).toThrow();
  expect(()=>stageTransition("assessing","completed")).toThrow();
});
it("отложенная возвращается на оценку; завершённую и отклонённую не переоткрывают",()=>{
  expect(stageTransition("planned","deferred")).toBe("deferred");
  expect(stageTransition("deferred","assessing")).toBe("assessing");
  expect(stageTransition("collecting","rejected")).toBe("rejected");
  expect(()=>stageTransition("deferred","planned")).toThrow();
  expect(()=>stageTransition("completed","assessing")).toThrow();
  expect(()=>stageTransition("rejected","assessing")).toThrow();
});
