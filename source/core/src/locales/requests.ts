const labels: Record<string, string> = {
  draft: "Черновик / Жоба",
  new: "Новая / Жаңа",
  reviewing: "На рассмотрении / Қарастырылуда",
  need_clarification: "Нужно уточнение / Нақтылау қажет",
  in_work: "В работе / Орындалуда",
  on_hold: "Отложена / Кейінге қалдырылды",
  awaiting_confirmation: "Ожидает подтверждения / Растауды күтуде",
  rework: "На доработке / Түзетуде",
  closed: "Закрыта / Жабылды",
  canceled: "Отменена / Тоқтатылды",
  rejected: "Отказано / Қабылданбады",
};
export const requestStateText = (state: unknown): string =>
  labels[String(state)] ?? "Неизвестный статус / Белгісіз күй";
