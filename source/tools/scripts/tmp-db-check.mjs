// Временная проверка: список применённых миграций и ключевые таблицы.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const envPath = new URL("../../.env.local", import.meta.url);
let dbUrl;
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^TEST_DATABASE_URL=(.*)\s*$/);
  if (m) dbUrl = m[1].replace(/^["']|["']$/g, "").trim();
}
const sql = postgres(dbUrl, { prepare: false, connect_timeout: 15 });
try {
  const mig = await sql`select version, name from supabase_migrations.schema_migrations order by version`;
  for (const r of mig) console.log("migration:", r.version, r.name);
  const tables = await sql`
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename in ('person','profile','building','staff_assignment','staff_scope','access_session','emulation_session','audit_log')
    order by tablename`;
  console.log("tables:", tables.map((t) => t.tablename).join(", "));
  const users = await sql`select count(*)::int as n from auth.users`;
  console.log("auth.users:", users[0].n);
} catch (e) {
  console.error("FAIL:", e.message);
} finally {
  await sql.end({ timeout: 5 });
}
