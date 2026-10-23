import { expect, it } from "vitest";
import { B1 } from "../../testing/actors.ts";
import { pollInput, answerInput } from "./input.ts";
const valid={question:"Какой день удобнее?",options:[{key:"sat",label:"Суббота"},{key:"sun",label:"Воскресенье"}],building_ids:[B1],closes_at:"2026-11-01T12:00:00+05:00"};
it("сохраняет стабильные ключи и нормализует срок",()=>{
  expect(pollInput(valid)).toEqual({...valid,closes_at:"2026-11-01T07:00:00.000Z"});
});
it("отклоняет повторные ключи/дома, пустой вопрос и неполный набор",()=>{
  for(const patch of [{options:[valid.options[0]]},{options:[valid.options[0],valid.options[0]]},{building_ids:[B1,B1]},{building_ids:[]},{question:" "},{closes_at:"вчера"}]) {
    expect(()=>pollInput({...valid,...patch})).toThrow();
  }
});
it("не принимает чужую личность, время, право и незнакомые поля ответа",()=>{
  expect(answerInput({option_key:"sat",expected_version:0})).toEqual({option_key:"sat",expected_version:0});
  for(const patch of [{person_id:B1},{answered_at:valid.closes_at},{eligible:true},{poll_id:B1},{option_key:""},{expected_version:-1}]) {
    expect(()=>answerInput({option_key:"sat",expected_version:0,...patch})).toThrow();
  }
});
