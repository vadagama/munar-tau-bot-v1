// Read-only release preflight. Does not print credentials or message contents.
// From source/: deno run --env-file=.env.local --allow-env --allow-net tools/scripts/audit-bot-button-templates.ts
import { createDbClient } from "../../core/src/db/client.ts";
import { loadTemplateStore } from "../../core/src/templates/store.ts";
import { auditButtonTemplates } from "../../core/src/templates/button-audit.ts";
const url = Deno.env.get("DATABASE_URL");
if (!url) throw new Error("DATABASE_URL is required");
const db = createDbClient(url, { max: 1, idleTimeout: 5 });
try {
  const issues = await db.transaction(async (exec) => {
    await exec.query("set transaction read only");
    return auditButtonTemplates(await loadTemplateStore(exec));
  });
  console.log(
    JSON.stringify({ compatible: issues.length === 0, issues }, null, 2),
  );
  if (issues.length) Deno.exitCode = 1;
} finally {
  await db.close();
}
