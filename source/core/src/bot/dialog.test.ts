import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../db/client.ts";
import { loadDialog, readDialog, saveDialog } from "./dialog.ts";

function database() {
  const rows = new Map<string, { state: Record<string, unknown>; profile: unknown; context: unknown }>();
  const exec: DbExecutor = { query: async <T>(sql: string, p: readonly unknown[] = []) => {
    const key = `${p[sql.startsWith("insert") ? 2 : sql.startsWith("update") ? 2 : 1]}:${p[0]}`;
    if (sql.startsWith("insert")) {
      const old = rows.get(key);
      if (!old || old.profile !== p[1] || old.context !== p[3]) rows.set(key, { state: {}, profile: p[1], context: p[3] });
    }
    if (sql.startsWith("update")) rows.get(key)!.state = JSON.parse(String(p[1]));
    if (sql.startsWith("select")) return (rows.has(key) ? [{ state: rows.get(key)!.state }] : []) as T[];
    return [];
  }};
  return exec;
}
describe("channel dialog", () => {
  it("keeps two bots of one Telegram account independent, including cancel", async () => {
    const db = database();
    await loadDialog(db, "12", "resident", "p");
    await saveDialog(db, "12", "resident", { step: "name" });
    await loadDialog(db, "12", "worker", "p");
    await saveDialog(db, "12", "worker", { step: "report" });
    expect(await loadDialog(db, "12", "resident", "p")).toEqual({ step: "name" });
    await saveDialog(db, "12", "worker", {});
    expect(await readDialog(db, "12", "resident")).toEqual({ step: "name" });
  });
  it("drops transient input when profile or emulation session changes", async () => {
    const db = database();
    await loadDialog(db, "12", "worker", "p", "session-1");
    await saveDialog(db, "12", "worker", { private: "draft" });
    expect(await loadDialog(db, "12", "worker", "p", "session-2")).toEqual({});
    await saveDialog(db, "12", "worker", { step: "report" });
    expect(await loadDialog(db, "12", "worker", "other", "session-2")).toEqual({});
  });
 it('drops a form when leaving its scenario, without touching the other bot',async()=>{
  const db=database();await loadDialog(db,'12','worker','p',null,'staff-requests');
  await saveDialog(db,'12','worker',{scenario:'staff-requests',form:{secret:'draft'}});
  expect(await loadDialog(db,'12','worker','p',null,'notifications')).toEqual({scenario:'notifications'});
 });

});
