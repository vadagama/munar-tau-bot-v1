import { expect, it } from "vitest";
import { describeWithDb } from "./with-db.ts";
import { setupTasks } from "./tasks-helpers.ts";
import { SEED } from "./helpers.ts";
import {
  createIncident,
  transitionIncident,
} from "../../src/domains/incidents/service.ts";
import { incidentScope } from "../../src/domains/incidents/access.ts";
import {
  acceptSignal,
  assignSignal,
  signalEmergency,
} from "../../src/domains/incidents/duty.ts";
import { fanoutBroadcasts } from "../../src/domains/incidents/broadcast.ts";
import { dispatchNotices } from "../../src/domains/notifications/service.ts";
import {
  savePublication,
  transitionPublication,
} from "../../src/domains/publications/service.ts";
describeWithDb("VS-7: инциденты, доставка, публикации", (getDb) => {
  it("повтор создания один; частичное восстановление откатывает переход", async () => {
    const { deps, admin } = await setupTasks(getDb());
    const input = {
      title: "Вода",
      place: "Общий стояк",
      service: "Вода",
      reason: "Сообщение дежурного",
      first_signal_at: new Date(Date.now() - 60000).toISOString(),
      responsible_person_id: admin.person.id,
      scope: [{ building_id: SEED.building1, service: "Холодная вода" }, {
        building_id: SEED.building1,
        service: "Горячая вода",
      }],
    };
    let row = await createIncident(deps, admin, input, "incident");
    expect((await createIncident(deps, admin, input, "incident")).id).toBe(
      row.id,
    );
    const base = {
      reason: "Проверено",
      public_text: "Отключение воды, срок уточняется",
      next_update_at: new Date(Date.now() + 3600000).toISOString(),
    };
    for (const action of ["confirm", "start_mitigation", "report_recovery"]) {
      row = await transitionIncident(deps, admin, row.id, {
        ...base,
        action,
        expected_version: row.version,
        executor: "Аварийная служба",
        started_at: new Date().toISOString(),
        check_method: "Осмотр",
        recovery_report: "Проверяем оба стояка",
      }, action);
    }
    const scope = await incidentScope(deps.db, row.id);
    await expect(transitionIncident(deps, admin, row.id, {
      ...base,
      action: "complete",
      expected_version: row.version,
      recovered_scope_ids: [scope[0]!.id],
      recovery_at: new Date().toISOString(),
      check_method: "Осмотр",
      final_report: "Вода восстановлена",
      danger_remains: false,
    }, "partial")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(
      (await deps.db.query<{ state: string }>(
        "select state from incident where id=$1",
        [row.id],
      ))[0]!.state,
    ).toBe("recovery_check");
    await expect(
      deps.db.query(
        "update incident_log set reason='rewrite' where incident_id=$1",
        [row.id],
      ),
    ).rejects.toThrow();
    await fanoutBroadcasts(deps);
    await fanoutBroadcasts(deps);
    await dispatchNotices(deps);
    expect(
      await deps.db.query(
        "select id from notification where channel='telegram'",
      ),
    ).toHaveLength(0);
    expect(
      await deps.db.query(
        "select dedup_key from notification group by dedup_key having count(*)>1",
      ),
    ).toHaveLength(0);
  });
  it("сигнал без смены назначается администратором; старый ответственный не принимает", async () => {
    const { deps, admin, worker, request } = await setupTasks(getDb());
    const signal = await signalEmergency(deps, worker, {
      request_id: request.id,
      description: "Опасная течь",
    }, "signal");
    expect(signal.stage).toBe("unassigned");
    const assigned = await assignSignal(deps, admin, signal.id, {
      expected_version: signal.version,
      responsible_person_id: admin.person.id,
      reason: "Замещаю отсутствующего дежурного",
    }, "assign");
    await expect(
      acceptSignal(deps, worker, signal.id, {
        expected_version: assigned.version,
      }, "wrong-person"),
    ).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    expect(
      (await acceptSignal(deps, admin, signal.id, {
        expected_version: assigned.version,
      }, "accept")).accepted_at,
    ).not.toBeNull();
  });
  it("плановое окончание отключения не подтверждает восстановление", async () => {
    const { deps, admin } = await setupTasks(getDb());
    let p = await savePublication(deps, admin, null, {
      kind: "outage",
      title: "Промывка",
      body: "Плановое отключение",
      requires_document: false,
      building_ids: [SEED.building1],
      service: "Вода",
      planned_start: "2026-01-01T08:00:00Z",
      planned_end: "2026-01-01T09:00:00Z",
      responsible_person_id: admin.person.id,
    }, "outage");
    p = await transitionPublication(deps, admin, p.id, {
      action: "publish",
      expected_version: p.version,
    }, "publish");
    expect(p.restored_at).toBeNull();
    expect(p.state).toBe("published");
    const blocked = await savePublication(deps, admin, null, {
      kind: "announcement",
      title: "Взносы",
      body: "Решение",
      requires_document: true,
      building_ids: [SEED.building1],
    }, "document");
    await expect(
      transitionPublication(deps, admin, blocked.id, {
        action: "publish",
        expected_version: blocked.version,
      }, "blocked"),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
