// Тестовые утилиты (не для продакшена): подпись HS256 для тестов функций и ядра.

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Подписывает JWT HS256 — как это делает Supabase Auth. */
export async function signTestJwt(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): Promise<string> {
  const head = bytesToBase64Url(encoder.encode(JSON.stringify(header)));
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${head}.${body}`));
  return `${head}.${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}
