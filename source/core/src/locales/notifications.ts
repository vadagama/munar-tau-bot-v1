export type LocalizedNotice = { ru: string; kk: string };
export function authorReminder(number: unknown): LocalizedNotice {
  return {
    ru: `${number}: подтвердите результат или верните на доработку.`,
    kk: `${number}: нәтижені растаңыз немесе түзетуге қайтарыңыз.`,
  };
}
export function adminCheck(number: unknown): LocalizedNotice {
  return {
    ru: `${number}: автор не ответил, требуется проверка администратора.`,
    kk: `${number}: автор жауап бермеді, әкімшінің тексеруі қажет.`,
  };
}
export function deliveryFailed(number: unknown): LocalizedNotice {
  return {
    ru:
      `${number}: важное уведомление не доставлено. Свяжитесь с жителем по телефону.`,
    kk: `${number}: маңызды хабарлама жеткізілмеді, тұрғынға қоңырау шалыңыз.`,
  };
}
export function firstResponseOverdue(number: unknown): LocalizedNotice {
  return {
    ru: `${number}: истёк срок первого ответа.`,
    kk: `${number}: алғашқы жауап мерзімі өтті.`,
  };
}
export function nextActionReminder(number: unknown): LocalizedNotice {
  return {
    ru: `${number}: наступила дата следующего действия.`,
    kk: `${number}: келесі әрекет күні келді.`,
  };
}
