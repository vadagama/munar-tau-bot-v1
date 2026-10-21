// Read-only release preflight. Does not print credentials or message contents.
// From source/: deno run --env-file=.env.local --allow-env --allow-net tools/scripts/audit-bot-button-templates.ts
// Demo migration config: --env-file=.env.migration with first argument NEW_DATABASE_URL.
import { createDbClient } from "../../core/src/db/client.ts";
import { loadTemplateStore } from "../../core/src/templates/store.ts";
import { auditButtonTemplates } from "../../core/src/templates/button-audit.ts";
// Optional first argument selects an existing connection variable, never a literal URI.
const variable = Deno.args[0] ?? "DATABASE_URL";
if (
  !["DATABASE_URL", "SUPABASE_DB_URL", "NEW_DATABASE_URL"].includes(variable)
) throw new Error("Unsupported connection variable");
const url = Deno.env.get(variable);
if (!url) throw new Error(`${variable} is required`);
const db = createDbClient(url, { max: 1, idleTimeout: 5 });
try {
  const { issues, registeredTemplates, customOverrides } = await db.transaction(
    async (exec) => {
      await exec.query("set transaction read only");
      const store = await loadTemplateStore(exec);
      return {
        issues: auditButtonTemplates(store),
        registeredTemplates: store.size,
        customOverrides: [...store.values()].filter((version) =>
          !version.useDefault
        ).length,
      };
    },
  );
  console.log(
    JSON.stringify(
      {
        compatible: issues.length === 0,
        registeredTemplates,
        customOverrides,
        issues,
      },
      null,
      2,
    ),
  );
  if (issues.length) Deno.exitCode = 1;
} finally {
  await db.close();
}
