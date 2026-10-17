import type { RegistryDeps } from "../registry/service.ts";
import { enqueueNotice, recipientActor } from "../notifications/service.ts";
import { startTimer } from "../registry/time.ts";
import { can } from "../../pdp/evaluate.ts";
import type { Row } from "../registry/validation.ts";
export async function sweepEmergencies(
  deps: RegistryDeps,
  now = new Date(),
  deadline = Date.now() + 10000,
) {
  let count = 0;
  const timers = await deps.db.query<
    { id: string; entity_id: string; stage: string }
  >(
    "select id,entity_id,stage from timer where stage in ('emergency:primary','emergency:reserve') and state='pending' and due_at<=$1 order by due_at limit 30",
    [now.toISOString()],
  );
  for (const timer of timers) {
    if (Date.now() >= deadline) break;
    await deps.db.transaction(async (exec) => {
      const [s] = await exec.query<Row>(
        "select * from emergency_signal where id=$1 for update",
        [timer.entity_id],
      );
      const claimed = await exec.query(
        "update timer set state='fired',fired_at=$2 where id=$1 and state='pending' returning id",
        [timer.id, now.toISOString()],
      );
      if (
        !claimed.length || !s || s.accepted_at ||
        timer.stage !== `emergency:${s.stage}`
      ) return;
      const [shift] = await exec.query<Row>(
        "select * from duty_shift where id=$1",
        [s.shift_id],
      );
      if (!shift) return;
      const reserve = s.stage === "primary",
        target = String(
          reserve ? shift.reserve_person_id : shift.admin_person_id,
        );
      const actor = await recipientActor(exec, target);
      const valid = actor && actor.person.isTest === s.is_test &&
        can(actor, reserve ? "incident.manage" : "incident.link", {
          incidentAccess: {
            buildingIds: [String(s.building_id)],
            isTest: Boolean(s.is_test),
            responsibleId: target,
            published: false,
            member: false,
          },
        }).allow;
      await exec.query(
        "update emergency_signal set responsible_person_id=$2,stage=$3,version=version+1 where id=$1",
        [s.id, valid ? target : null, reserve ? "reserve" : "administrator"],
      );
      await exec.query(
        "insert into emergency_signal_log(signal_id,action,responsible_person_id) values($1,$2,$3)",
        [
          s.id,
          reserve ? "escalated_reserve" : "escalated_administrator",
          valid ? target : null,
        ],
      );
      const recipients = new Set<string>();
      if (valid) recipients.add(target);
      if (reserve) recipients.add(String(shift.admin_person_id));
      else {
        const chairs = await exec.query<{ person_id: string }>(
          "select distinct a.person_id from staff_assignment a join person p on p.id=a.person_id where a.role='chairman' and a.status='active' and p.status='active' and p.is_test=$1 and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())",
          [s.is_test],
        );
        for (const c of chairs) recipients.add(c.person_id);
      }
      for (const personId of recipients) {
        await enqueueNotice(exec, {
          personId,
          key: `signal:${s.id}:${timer.stage}:${personId}`,
          type: "incident",
          bot: "worker",
          important: true,
          isTest: Boolean(s.is_test),
          buildingIds: [String(s.building_id)],
          signalId: String(s.id),
          text: {
            ru:
              `Возможная авария ${s.id}: нет принятия. Ответственность передана ${
                reserve ? "резервному дежурному" : "администратору"
              }${
                valid ? "" : "; назначение недействительно, требуется замена"
              }.`,
            kk: `Ықтимал апат ${s.id}: қабылданбады. Жауапкершілік ${
              reserve ? "резервтік кезекшіге" : "әкімшіге"
            } берілді${valid ? "" : "; жаңа жауаптыны тағайындау қажет"}.`,
          },
        });
      }
      if (reserve) {
        await startTimer(
          exec,
          "emergency_reserve",
          String(s.id),
          "emergency:reserve",
          now,
        );
      }
      count++;
    });
  }
  // Обещанное обновление — событие с дедупом, а не смена состояния инцидента.
  const overdue = await deps.db.query<
    {
      id: string;
      version: number;
      responsible_person_id: string;
      is_test: boolean;
      next_update_at: string;
    }
  >(
    `select i.id,i.version,i.responsible_person_id,i.is_test,i.next_update_at from incident i where i.next_update_at<=$1 and i.state not in ('completed','not_confirmed') and (
 not exists(select 1 from outbox o where o.dedup_key='incident:'||i.id||':update:'||i.version)
 or exists(select 1 from timer t where t.entity_id=i.id and t.stage='incident:update:'||i.version and t.state='pending' and t.due_at<=$1)
 or (exists(select 1 from time_rule r join time_rule_version v on v.rule_id=r.id where r.key='incident_update_escalation') and not exists(select 1 from timer t where t.entity_id=i.id and t.stage='incident:update:'||i.version))) order by i.next_update_at limit 30`,
    [now.toISOString()],
  );
  for (const row of overdue) {
    if (Date.now() >= deadline) break;
    await deps.db.transaction(async (exec) => {
      await enqueueNotice(exec, {
        personId: row.responsible_person_id,
        incidentId: row.id,
        key: `incident:${row.id}:update:${row.version}`,
        type: "incident",
        bot: "worker",
        important: true,
        isTest: row.is_test,
        text: {
          ru:
            `Авария ${row.id}: пропущено обещанное обновление. Опубликуйте актуальные сведения.`,
          kk:
            `Апат ${row.id}: жоспарланған жаңарту кешіктірілді. Өзекті ақпаратты жариялаңыз.`,
        },
      });
      const chairs = await exec.query<{ person_id: string }>(
        "select distinct a.person_id from staff_assignment a join person p on p.id=a.person_id where a.role='chairman' and a.status='active' and p.is_test=$1 and p.status='active' and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())",
        [row.is_test],
      );
      // Эскалация только по настроенной версии, без выдуманного норматива.
      const [rule] = await exec.query<{ id: string }>(
        "select v.id from time_rule r join time_rule_version v on v.rule_id=r.id where r.key='incident_update_escalation' order by v.version desc limit 1",
      );
      if (rule) {
        const exists = await exec.query(
          "select id from timer where entity_id=$1 and stage=$2",
          [row.id, `incident:update:${row.version}`],
        );
        if (!exists.length) {
          await startTimer(
            exec,
            "incident_update_escalation",
            row.id,
            `incident:update:${row.version}`,
            new Date(row.next_update_at),
          );
        }
        const fired = await exec.query(
          "update timer set state='fired',fired_at=$3 where entity_id=$1 and stage=$2 and state='pending' and due_at<=$3 returning id",
          [row.id, `incident:update:${row.version}`, now.toISOString()],
        );
        if (fired.length) {
          for (const c of chairs) {
            await enqueueNotice(exec, {
              personId: c.person_id,
              incidentId: row.id,
              key: `incident:${row.id}:escalated:${row.version}:${c.person_id}`,
              type: "incident",
              bot: "worker",
              isTest: row.is_test,
              text: {
                ru:
                  `Авария ${row.id}: ответственный не обновил сведения. Требуется вмешательство.`,
                kk:
                  `Апат ${row.id}: жауапты ақпаратты жаңартпады. Араласу қажет.`,
              },
            });
          }
        }
      }
    });
  }
  return count;
}
