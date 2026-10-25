import { createContext } from "react";

/** Нижняя область карточки для основного действия процесса на телефоне. */
export const MobileActionContext = createContext<HTMLDivElement | null>(null);
