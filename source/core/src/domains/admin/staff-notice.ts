import type { DbExecutor } from "../../db/client.ts";
import type { Actor, StaffRole } from "../../pdp/types.ts";
import { ROLE_LABELS, ROLE_LABELS_KK } from "../../pdp/roles.ts";
import { fmtDate } from "../../bot/text.ts";
import { templateNotice } from "../../templates/notice.ts";
import { notifyPerson } from "../registrations/notifications.ts";
export async function notifyRoleChange(
  exec: DbExecutor,
  actor: Actor,
  id: string,
  before: StaffRole[],
  after: StaffRole[],
  reason: string,
  key: string,
  isTest: boolean,
) {
  await notifyPerson(
    exec,
    id,
    templateNotice("notices.staff.roles_changed", {
      before_ru: before.map((r) => ROLE_LABELS[r]).join(", ") ||
        "Нет служебных ролей",
      before_kk: before.map((r) => ROLE_LABELS_KK[r]).join(", ") ||
        "Қызметтік рөлдер жоқ",
      after_ru: after.map((r) => ROLE_LABELS[r]).join(", ") ||
        "Служебные полномочия прекращены",
      after_kk: after.map((r) => ROLE_LABELS_KK[r]).join(", ") ||
        "Қызметтік өкілеттіктер тоқтатылды",
      actor_name: actor.person.fullName,
      at: fmtDate(new Date()),
      reason,
    }),
    key,
    {
      type: "staff.roles",
      audience: "personal",
      bot: "worker",
      isTest,
      important: true,
    },
  );
}
