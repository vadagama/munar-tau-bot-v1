// Временная проверка: состояние JWT-ключей подписи dev-проекта (Management API).
// Печатает только нечувствительные флаги конфигурации.
import { existsSync, readFileSync } from "node:fs";

const envPath = new URL("../../.env.local", import.meta.url);
if (!existsSync(envPath)) {
  console.error("нет .env.local");
  process.exit(1);
}
const vars = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)\s*$/);
  if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
if (!vars.SUPABASE_ACCESS_TOKEN || !vars.SUPABASE_PROJECT_ID) {
  console.error("нет токена или project id");
  process.exit(1);
}

const base = `https://api.supabase.com/v1/projects/${vars.SUPABASE_PROJECT_ID}`;
const headers = { Authorization: `Bearer ${vars.SUPABASE_ACCESS_TOKEN}` };

async function tryGet(url, pick) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.log(`${url.split("/v1/")[1]}: HTTP ${res.status}`);
    return;
  }
  const json = await res.json();
  pick(json);
}

// 1) Конфиг Auth: ищем поля про jwt/keys/alg
await tryGet(`${base}/config/auth`, (json) => {
  const interesting = Object.entries(json).filter(([k]) =>
    /jwt|key|alg|secret|signing/i.test(k),
  );
  for (const [k, v] of interesting) console.log("auth:", k, "=", JSON.stringify(v));
});

// 2) Специализированные endpoints ключей подписи (встречаются в Management API)
await tryGet(`${base}/config/auth/signing-keys`, (json) => {
  if (Array.isArray(json)) {
    for (const k of json) {
      console.log("signing-key:", k.status ?? "", k.algorithm ?? k.alg ?? "", k.key_id ?? k.id ?? "");
    }
  } else {
    console.log("signing-keys:", JSON.stringify(json).slice(0, 500));
  }
});
