// Одноразовая проверка меню бота (читает текущие значения через Bot API).
// Из source/: deno run --env-file=.env.local --allow-env --allow-net tools/scripts/check-bot-commands.ts
const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN не задан");
  Deno.exit(1);
}
const call = async (method: string, payload: Record<string, unknown> = {}) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as {
    ok: boolean;
    result?: unknown;
    description?: string;
  };
  if (!result.ok) throw new Error(`${method}: ${result.description}`);
  return result.result;
};
for (const lang of [undefined, "ru", "kk"]) {
  const commands = await call("getMyCommands", lang ? { language_code: lang } : {}) as
    | { command: string; description: string }[]
    | undefined;
  const label = lang ?? "default";
  console.log(`[${label}] ${commands?.length ?? 0} команд: ${
    commands?.map((c) => `/${c.command}`).join(", ")
  }`);
  const description = await call("getMyDescription", lang ? { language_code: lang } : {}) as
    | { description: string }
    | undefined;
  console.log(`[${label}] описание: ${description?.description}`);
}
