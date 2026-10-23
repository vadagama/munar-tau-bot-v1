import { describe, expect, it } from "vitest";
import { makeTestActor, B1, B2 } from "../testing/actors.ts";
import { can } from "./evaluate.ts";
import type { ResourceRef } from "./types.ts";

const resource=(fields:Partial<NonNullable<ResourceRef["pollAccess"]>>={}):ResourceRef=>({pollAccess:{buildingIds:[B1],isTest:false,state:"open",member:false,participant:false,finalParticipant:false,answerOpen:true,...fields}});
const staff=makeTestActor("administrator",[B1]), resident=makeTestActor("executor",[B2]);
describe("PDP POL-01–04",()=>{
  it("создаёт/меняет опрос только управляющий всей области",()=>{
    expect(can(staff,"poll.manage",resource()).allow).toBe(true);
    expect(can(staff,"poll.manage",resource({buildingIds:[B1,B2]})).allow).toBe(false);
    expect(can(makeTestActor("tech_admin",[]),"poll.manage",resource()).allow).toBe(false);
    expect(can(resident,"poll.manage",resource({member:true})).allow).toBe(false);
  });
  it("служебная роль не даёт голос без связи; срок закрыт сервером",()=>{
    expect(can(staff,"poll.answer",resource()).allow).toBe(false);
    expect(can(resident,"poll.answer",resource({member:true})).allow).toBe(true);
    expect(can(resident,"poll.answer",resource({member:true,answerOpen:false})).allow).toBe(false);
    expect(can(resident,"poll.answer",resource({member:true,state:"closed"})).allow).toBe(false);
  });
  it("черновик скрыт от жителя; открытый виден только действующему участнику аудитории",()=>{
    expect(can(resident,"poll.read",resource({member:true,state:"draft"})).allow).toBe(false);
    expect(can(resident,"poll.read",resource({member:true})).allow).toBe(true);
    expect(can(resident,"poll.read",resource()).allow).toBe(false);
  });
  it("итоги доступны управляющему и окончательному участнику после переезда",()=>{
    expect(can(staff,"poll.results",resource()).allow).toBe(true);
    expect(can(resident,"poll.results",resource({member:true})).allow).toBe(false);
    expect(can(resident,"poll.results",resource({state:"closed",finalParticipant:true})).allow).toBe(true);
    expect(can(resident,"poll.results",resource({state:"closed",member:true})).allow).toBe(false);
  });
  it("отменённое распределение закрыто всем; участник может прочитать причину",()=>{
    for(const actor of [staff,resident]) expect(can(actor,"poll.results",resource({state:"canceled",participant:true,finalParticipant:true})).allow).toBe(false);
    expect(can(resident,"poll.read",resource({state:"canceled",participant:true})).allow).toBe(true);
  });
  it("режим и активность проверяются до служебных/личных разрешений",()=>{
    expect(can(staff,"poll.manage",resource({isTest:true})).allow).toBe(false);
    expect(can({...staff,person:{...staff.person,status:"archived"}},"poll.read",resource()).allow).toBe(false);
    expect(can(staff,"poll.read",{}).allow).toBe(false);
  });
});
