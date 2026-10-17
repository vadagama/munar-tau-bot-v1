/**
 * Подписи реестра (срез UX B): один источник, два языка. Бот и доменные
 * уведомления берут подпись по языку профиля получателя.
 */
export interface Loc {
  ru: string;
  kk: string;
}

export const premiseLabels: Record<string, Loc> = {
  apartment: { ru: "Квартира", kk: "Пәтер" },
  commercial: { ru: "Коммерческое помещение", kk: "Коммерциялық нысан" },
  parking_slot: { ru: "Парковочное место", kk: "Тұрақ орны" },
  storage: { ru: "Кладовка", kk: "Қойма" },
};
export const roleLabels: Record<string, Loc> = {
  owner: { ru: "Собственник", kk: "Меншік иесі" },
  tenant: { ru: "Арендатор", kk: "Жалға алушы" },
  resident: { ru: "Проживающий", kk: "Тұрғын" },
  other: { ru: "Пользователь", kk: "Пайдаланушы" },
};
export const stateLabels: Record<string, Loc> = {
  pending_review: { ru: "Ожидает проверки", kk: "Тексеруді күтуде" },
  need_clarification: { ru: "Нужны уточнения", kk: "Нақтылау қажет" },
  approved: { ru: "Доступ подтверждён", kk: "Қолжетімділік расталды" },
  rejected: { ru: "Отказано", kk: "Бас тартылды" },
  disputed: { ru: "Спор", kk: "Дау" },
  withdrawn: { ru: "Отозвана", kk: "Кері қайтарылды" },
  active: { ru: "Действует", kk: "Белсенді" },
  pending: { ru: "Не подтверждено", kk: "Расталмаған" },
  revoked: { ru: "Прекращено", kk: "Тоқтатылған" },
};

/** Подпись на одном языке; нет записи — запасной текст (обычно сам ключ). */
export function label(
  map: Record<string, Loc>,
  key: unknown,
  lang: "ru" | "kk",
  fallback?: string,
): string {
  const value = map[String(key)];
  return value ? value[lang] : fallback ?? String(key ?? "");
}
