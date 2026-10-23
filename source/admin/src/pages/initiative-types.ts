import { pollDate } from "./poll-types";
export const initiativeDate=(value:string|null|undefined)=>value?pollDate(value):"—";
export const initiativeStates:Record<string,string>={submitted:"На рассмотрении",published:"Опубликована",collecting:"Сбор поддержки",assessing:"Оценка",planned:"В плане",implementing:"В реализации",completed:"Выполнена",rejected:"Отклонена",deferred:"Отложена"};
export const initiativeNext:Record<string,string[]>={submitted:["publish","reject"],collecting:["assessing","rejected","deferred"],assessing:["planned","rejected","deferred"],planned:["implementing","rejected","deferred"],implementing:["completed","rejected","deferred"],deferred:["assessing","rejected"]};
export const transitionNames:Record<string,string>={...initiativeStates,publish:"Опубликовать",reject:"Отказать в публикации"};
export interface InitiativeView {
 buildings?:{id:string;label:string}[];id:string;title:string;body:string;location_text:string;publication_state:string;stage:string|null;version:number;
 requested_building_ids:string[];approved_building_ids:string[];review_reason:string|null;stage_reason:string|null;
 can_manage:boolean;can_comment:boolean;can_support:boolean;can_moderate:boolean;support_count:number;own_support:{version:number;supported:boolean};
 plan_basis:string|null;responsible_name:string|null;responsible_person_id?:string|null;estimated_due_at:string|null;owner_decision_required:boolean;decision_document_version_id?:string|null;
}
export interface InitiativeComment {id:string;initiative_id:string;author_name:string;body:string;hidden:boolean;created_at:string}
export interface ModerationView {id:string;initiative_id:string;kind:string;comment_id:string|null;reason:string;until_at:string|null;original_until_at:string|null;revoked_at:string|null;version:number;decisions?:{resolution:string;reason:string;until_at:string|null}[];can_appeal?:boolean}
export interface AppealView {id:string;action_id:string;reason:string;status:string;version:number;action:ModerationView;can_resolve:boolean;decisions:{resolution:string;reason:string;until_at:string|null}[]}
