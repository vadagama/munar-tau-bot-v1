import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "./api";
import { useCabinetIdentity } from "./identity";
import { requestOverdue } from "../pages/request-overdue";

// Очередь дня (Operate): что требует действия сотрудника прямо сейчас.
// Один набор данных кормит и главную, и бейджи меню; обновление — по
// PAGE_REFRESH_EVENT (конвенция кабинета, кнопок «Обновить» нет).

export interface QueueRow {
  id: string;
  number?: unknown;
  title?: unknown;
  description?: unknown;
  state: string;
  due_at?: unknown;
  first_response_due_at?: unknown;
  created_at?: unknown;
  building_name?: unknown;
  author_name?: unknown;
}

export interface DayQueue {
  requestsNew: QueueRow[];
  requestsAction: QueueRow[];
  requestsOverdue: number;
  tasksAccept: QueueRow[];
  tasksReview: QueueRow[];
  incidentsAction: QueueRow[];
  loading: boolean;
  error: string | null;
}

const EMPTY: DayQueue = {
  requestsNew: [], requestsAction: [], requestsOverdue: 0,
  tasksAccept: [], tasksReview: [], incidentsAction: [],
  loading: true, error: null,
};

const DayQueueContext = createContext<DayQueue>(EMPTY);

export function DayQueueProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DayQueue>(EMPTY);
  const { identity, roles } = useCabinetIdentity();
  const manage = roles.some(
    (role) => ["chairman", "administrator", "deputy"].includes(role),
  );

  const load = useCallback(async () => {
    try {
      const [requestsLatest, tasks, incidents] = await Promise.all([
        apiFetch<{ items: QueueRow[] }>("/v1/requests/search", {
          method: "POST",
          body: {},
        }),
        apiFetch<{ items: QueueRow[] }>("/v1/tasks"),
        apiFetch<{ items: QueueRow[] }>("/v1/incidents"),
      ]);
      const open = requestsLatest.items.filter(
        (row) => !["draft", "closed", "canceled", "rejected"].includes(row.state),
      );
      const actionStates = manage
        ? ["new", "need_clarification", "awaiting_confirmation"]
        : ["need_clarification", "awaiting_confirmation"];
      setQueue({
        requestsNew: open.filter((row) => row.state === "new"),
        requestsAction: open.filter((row) => actionStates.includes(row.state)),
        requestsOverdue: open.filter((row) => requestOverdue(row as unknown as Record<string, unknown>)).length,
        tasksAccept: tasks.items.filter((row) =>
          row.state === "awaiting_acceptance" || row.state === "created"),
        tasksReview: tasks.items.filter((row) => row.state === "on_review"),
        incidentsAction: incidents.items.filter((row) =>
          ["signal_check", "confirmed", "recovery_check"].includes(row.state)),
        loading: false,
        error: null,
      });
    } catch (e) {
      setQueue((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : "Ошибка загрузки очереди",
      }));
    }
  }, [manage]);

  useEffect(() => {
    if (!identity) return;
    void load();
    // Очередь перечитывается при смене идентичности; load меняется только с ролью.
  }, [load]);

  return <DayQueueContext.Provider value={queue}>{children}</DayQueueContext.Provider>;
}

export function useDayQueue(): DayQueue {
  return useContext(DayQueueContext);
}
