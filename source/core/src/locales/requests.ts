import type { Loc } from "./registry.ts";

const labels: Record<string, Loc> = {
  draft: { ru: "Черновик", kk: "Жоба" },
  new: { ru: "Новая", kk: "Жаңа" },
  reviewing: { ru: "На рассмотрении", kk: "Қарастырылуда" },
  need_clarification: { ru: "Нужно уточнение", kk: "Нақтылау қажет" },
  in_work: { ru: "В работе", kk: "Орындалуда" },
  on_hold: { ru: "Отложена", kk: "Кейінге қалдырылды" },
  awaiting_confirmation: { ru: "Ожидает подтверждения", kk: "Растауды күтуде" },
  rework: { ru: "На доработке", kk: "Түзетуде" },
  closed: { ru: "Закрыта", kk: "Жабылды" },
  canceled: { ru: "Отменена", kk: "Тоқтатылды" },
  rejected: { ru: "Отказано", kk: "Қабылданбады" },
};
/** Подпись состояния обращения: одна — по языку получателя. */
export function requestStateText(state: unknown, lang: "ru" | "kk"): string {
  const value = labels[String(state)];
  if (!value) return lang === "kk" ? "Белгісіз күй" : "Неизвестный статус";
  return value[lang];
}

/** Подпись как пара языков — для локализуемых уведомлений вне бота. */
export function requestStateLoc(state: unknown): Loc {
  return labels[String(state)] ?? { ru: "Неизвестный статус", kk: "Белгісіз күй" };
}
