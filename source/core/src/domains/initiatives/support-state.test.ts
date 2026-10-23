import { expect,it } from "vitest";
import { calculateSupport } from "./support-state.ts";
it("потеря аудитории исключает поддержку, восстановление не возвращает её автоматически",()=>{
  const histories=new Map([["person",[{from:0,until:2},{from:3,until:Infinity}]]]);
  expect(calculateSupport([{person_id:"person",version:1,supported_us:"1"}],histories,4).count).toBe(0);
  expect(calculateSupport([{person_id:"person",version:2,supported_us:"3"}],histories,4).count).toBe(1);
});
it("итог использует левую границу завершения, поздняя потеря связи не меняет его",()=>{
  const histories=new Map([["person",[{from:0,until:10}]]]);
  const rows=[{person_id:"person",version:1,supported_us:"1"}];
  expect(calculateSupport(rows,histories,10).count).toBe(0);
  expect(calculateSupport(rows,histories,10,true).count).toBe(1);
  expect(calculateSupport([{...rows[0]!,supported_us:"10"}],histories,10,true).count).toBe(0);
});
