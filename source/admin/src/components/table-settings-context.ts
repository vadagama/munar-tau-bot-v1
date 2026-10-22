import { createContext } from "react";

export const TableSettingsContext = createContext<{
  target: HTMLDivElement | null;
  register: () => () => void;
} | null>(null);
