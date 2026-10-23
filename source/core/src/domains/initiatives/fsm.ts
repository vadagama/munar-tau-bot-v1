import { ApiError } from "../../errors/api.ts";
import type { InitiativeStage,PublicationState } from "./types.ts";
export function publicationTransition(state:PublicationState,action:"publish"|"reject"):PublicationState {
  if(state!=="submitted")throw new ApiError("INVALID_TRANSITION");
  return action==="publish"?"published":"rejected";
}
const next:Record<InitiativeStage,readonly InitiativeStage[]>={
  collecting:["assessing","rejected","deferred"],
  assessing:["planned","rejected","deferred"],
  planned:["implementing","rejected","deferred"],
  implementing:["completed","rejected","deferred"],
  deferred:["assessing","rejected"],completed:[],rejected:[],
};
export function stageTransition(state:InitiativeStage,target:InitiativeStage):InitiativeStage {
  if(!next[state]?.includes(target))throw new ApiError("INVALID_TRANSITION");
  return target;
}
