import type { TemplateDef } from "./types.ts";
const variables=[{name:"question",description:"Вопрос опроса",example:"Когда проводить встречу?"},{name:"reason",description:"Причина отмены",example:"Вопрос уточняется"}];
const buttons=[{id:"open",ru:"Открыть опрос",kk:"Сауалнаманы ашу"}];
export const pollTemplates:readonly TemplateDef[]=[{
  key:"notices.polls.canceled",section:"notices",title:"Опрос отменён",scenario:"Информационные опросы",description:"Участнику ранее данного ответа; индивидуальный выбор не раскрывается.",variables,buttons,
  ru:"Опрос «{question}» отменён.\nПричина: {reason}\nРезультаты отменённого опроса не публикуются.",
  kk:"«{question}» сауалнамасы тоқтатылды.\nСебебі: {reason}\nТоқтатылған сауалнаманың нәтижелері жарияланбайды.",
},{
  key:"notices.polls.closed",section:"notices",title:"Опрос завершён",scenario:"Информационные опросы",description:"Участнику окончательного снимка; сводка доступна в карточке.",variables,buttons,
  ru:"Информационный опрос «{question}» завершён. Сводные результаты доступны в карточке. Опрос не является решением собрания.",
  kk:"«{question}» ақпараттық сауалнамасы аяқталды. Жиынтық нәтижелер карточкада қолжетімді. Сауалнама жиналыс шешімі болып саналмайды.",
}];
