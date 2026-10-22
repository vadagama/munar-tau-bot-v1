type Row = Record<string, unknown>;
export interface ProcessGuidance { title: string; description: string; waitingFor: string; primary?: string }
const guide = (title: string, description: string, waitingFor: string, primary?: string): ProcessGuidance => ({ title, description, waitingFor, primary });
const unknown = () => guide("Проверьте текущее состояние", "Доступные операции зависят от состояния и ваших полномочий. Подробности — в материалах и истории.", "Не определено");

export function requestGuidance(row: Row, manage: boolean, own: boolean): ProcessGuidance {
 const state = String(row.state);
 if (manage && row.cancel_request) return guide("Нужно рассмотреть запрос отмены", "Проверьте основание и последствия для связанных заданий, затем согласуйте или отклоните отмену.", "Управляющий", "approve_cancel");
 const pending = ((row.tasks as Row[] | undefined) ?? []).filter(t => t.is_required !== false && t.state !== "accepted_admin");
 switch (state) {
  case "draft": return guide("Обращение ещё не отправлено", "Проверьте описание и место перед отправкой в ОСИ.", "Автор", own ? "submit" : undefined);
  case "new": return guide("Нужно рассмотреть обращение", "Ознакомьтесь с описанием и примите обращение на рассмотрение. Если данных недостаточно — запросите уточнение.", "Управляющий", manage ? "start_review" : undefined);
  case "reviewing": return guide("Нужно определить дальнейшие действия", row.kind === "request" ? "Если данных достаточно, назначьте исполнителя, объём работы и срок. Иначе запросите уточнение." : "Подготовьте итоговый ответ. Если нужна работа исполнителя — создайте задание через «Начать работу».", "Управляющий", manage ? row.kind === "request" ? "start_work" : "submit_result" : undefined);
  case "need_clarification": return guide("Ожидаем уточнения", "Вопрос и ответы находятся в переписке. После ответа управляющий снимает уточнение и продолжает рассмотрение.", "Автор / управляющий", !manage && own ? "answer_clarification" : undefined);
  case "in_work": return guide("Обращение в работе", pending.length ? `Заданий без принятого результата: ${pending.length}. Откройте связанные задания и проверьте выполнение.` : "Проверьте связанные задания и материалы. Итоговый ответ отправляется после выполнения обязательного объёма и проверки документов.", "Исполнитель / управляющий", manage && !pending.length ? "submit_result" : undefined);
  case "on_hold": return guide("Работа отложена", "Проверьте причину и дату следующего действия в истории. Возобновление выполняется явно; сроки не обнуляются.", "Управляющий", manage ? "resume" : undefined);
  case "awaiting_confirmation": return guide("Ожидаем подтверждения результата", own ? "Изучите итоговый ответ и подтвердите результат либо верните его с замечаниями." : "Результат передан автору. Ожидаем его решения; административное закрытие требует отдельной проверки.", "Автор", own ? "confirm_result" : undefined);
  case "rework": return guide("Нужно организовать доработку", "Изучите замечания автора и определите объём исправлений и срок.", "Управляющий", manage ? "plan_rework" : undefined);
  case "closed": return guide("Обращение закрыто", "Результат и основание закрытия сохранены. При необходимости используйте предусмотренное процессом повторное открытие.", "Действий не требуется");
  case "canceled": return guide("Обращение отменено", "Основание отмены и связанные действия сохранены в истории.", "Действий не требуется");
  case "rejected": return guide("По обращению отказано", "Основание находится в истории. Автор может оспорить отказ; пересмотр выполняется уполномоченным сотрудником.", "Автор — при несогласии", own ? "appeal_reject" : undefined);
  default: return unknown();
 }
}

export function taskGuidance(row: Row): ProcessGuidance {
 const execute = row.can_execute === true, manage = row.can_manage === true;
 switch (row.state) {
  case "created": return guide("Нужно назначить исполнителя", "Проверьте инструкцию, срок и требования к результату, затем направьте задание сотруднику.", "Управляющий", manage ? "assign" : undefined);
  case "awaiting_acceptance": return guide("Ожидаем принятия задания", "Исполнитель проверяет инструкцию и срок, затем принимает задание или отказывается с причиной.", "Исполнитель", execute ? "accept" : undefined);
  case "accepted": return guide("Задание принято", "Перед началом проверьте доступ, зависимости и условия выполнения. Управляющий ожидает начала работы исполнителем.", "Исполнитель", execute ? "start" : undefined);
  case "in_progress": return guide("Ожидаем выполнения и отчёта", "Исполнитель выполняет инструкцию и прикладывает доказательства к отчёту. При препятствиях сообщите о проблеме или запросите приостановку.", "Исполнитель", execute ? "report" : undefined);
  case "suspended": return guide("Выполнение приостановлено", "Проверьте причину остановки и условия продолжения. Возобновление подтверждает управляющий.", "Управляющий", manage ? "resume" : undefined);
  case "on_review": return guide("Нужно проверить отчёт", row.can_approve === false && manage ? "Приёмка собственного результата недоступна. Независимый управляющий должен проверить отчёт; замечания можно вернуть на доработку." : "Изучите результат, доказательства и ограничения в разделе «Отчёты», затем примите результат или верните замечания.", "Независимый управляющий", manage && row.can_approve === true ? "approve" : undefined);
  case "rework": return guide("Нужна доработка результата", "Изучите замечания в истории, выполните исправления и представьте новый отчёт.", "Исполнитель", execute ? "start" : undefined);
  case "accepted_admin": return guide("Результат задания принят", "Приёмка задания не закрывает обращение автоматически: его результат передаётся автору отдельным действием.", "Действий по заданию не требуется");
  case "canceled": return guide("Задание отменено", row.is_required ? "Обязательный объём не считается выполненным. Управляющему необходимо оформить замену или изменение объёма." : "Основание отмены сохранено в истории.", row.is_required ? "Управляющий" : "Действий не требуется", manage && row.is_required ? "replace_canceled" : undefined);
  default: return unknown();
 }
}

export function incidentGuidance(row: Row): ProcessGuidance {
 const variants: Record<string, ProcessGuidance> = {
  signal_check: guide("Нужно проверить аварийный сигнал", "Проверьте сведения и охват. Подтвердите аварию либо зафиксируйте, что сигнал не подтвердился.", "Дежурный / управляющий", "confirm"),
  confirmed: guide("Нужно организовать устранение", "Проверьте ответственного и охват, затем начните устранение.", "Дежурный / управляющий", "start_mitigation"),
  mitigation: guide("Ожидаем устранения аварии", "Обновляйте прогноз и сведения для жителей. После устранения сообщите о восстановлении для проверки.", "Ответственный за устранение", "report_recovery"),
  recovery_check: guide("Нужно проверить восстановление", "Проверьте каждую затронутую зону и отсутствие опасности. Завершение требует явного подтверждения проверок.", "Проверяющий", "complete"),
  completed: guide("Авария завершена", "Результат по связанным обращениям передаётся отдельно, с проверкой их обязательных заданий.", "Управляющий — по связанным обращениям"),
  not_confirmed: guide("Авария не подтвердилась", "Решение сохранено. При новых сведениях доступна повторная проверка согласно полномочиям.", "Действий не требуется"),
 };
 const result = variants[String(row.state)] ?? unknown();
 return {...result, primary: (row.actions as string[] | undefined)?.includes(result.primary ?? "") ? result.primary : undefined};
}

export function publicationGuidance(row: Row, manage: boolean, chairman: boolean): ProcessGuidance {
 switch (row.state) {
  case "draft": return guide("Нужно подготовить публикацию", "Проверьте текст, аудиторию и материалы. Финансовый отчёт сначала направляется на согласование председателю.", "Редактор", manage ? row.kind === "financial_report" ? "submit_approval" : "publish" : undefined);
  case "pending_approval": return guide("Ожидаем согласования председателя", "Проверьте содержание и основания финансового отчёта. Публикация возможна после предусмотренного согласования.", "Председатель", manage && chairman ? "approve" : undefined);
  case "scheduled": return guide("Публикация запланирована", "Ожидаем установленного времени публикации. При изменении планов доступно архивирование.", "Система");
  case "published": return row.kind === "outage" && !row.restored_at ? guide("Ожидаем восстановления после отключения", "Следите за актуальностью плана. После проверки фактического восстановления подтвердите его отдельно.", "Управляющий", manage ? "restore" : undefined) : guide("Материал опубликован", "Материал доступен выбранной аудитории. Доставка уведомления не означает прочтения.", "Действий не требуется");
  case "archived": return guide("Публикация в архиве", "Сведения и история публикации сохранены.", "Действий не требуется");
  default: return unknown();
 }
}
