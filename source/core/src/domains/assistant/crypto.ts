// Шифрование токена провайдера (ADR-021, S0.2): AES-256-GCM на уровне
// приложения — формат `v1:<iv_b64>:<ct_b64>`. Vault не используется: рабочая
// среда — self-hosted (ADR-003), где Vault может отсутствовать, а AES-GCM
// работает одинаково в облаке и на self-hosted. Ключ шифрования — 32 байта
// (base64) в секрете функций ASSISTANT_API_KEY_SECRET, вне кода и сборки.

const ALGORITHM = { name: "AES-GCM", length: 256 } as const;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const FORMAT_VERSION = "v1";

/** Расшифровка b64-строки в байты (atob доступен в Deno, Node ≥ 16 и браузере). */
function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Ключ шифрования из секрета: base64, ровно 32 байта. */
export function decodeKeySecret(secret: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(secret.trim());
  } catch {
    throw new Error("ASSISTANT_API_KEY_SECRET: ожидается base64");
  }
  if (bytes.length !== KEY_BYTES) {
    throw new Error(
      `ASSISTANT_API_KEY_SECRET: нужно ${KEY_BYTES} байт, получено ${bytes.length}`,
    );
  }
  return bytes;
}

/** Случайный ключ шифрования (base64) — для генерации секрета среды. */
export function generateKeySecret(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

async function importKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", key as BufferSource, ALGORITHM, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Токен провайдера → `v1:<iv_b64>:<ct_b64>` (тег аутентификации GCM в хвосте ct). */
export async function encryptApiKey(
  plaintext: string,
  key: Uint8Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { ...ALGORITHM, iv: iv as BufferSource },
    await importKey(key),
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  return `${FORMAT_VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

/** Обратное шифрованию; сбой формата/ключа — ошибка конфигурации сервера. */
export async function decryptApiKey(
  token: string,
  key: Uint8Array,
): Promise<string> {
  const parts = token.split(":");
  if (parts.length !== 3 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Неизвестный формат шифрованного ключа провайдера");
  }
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(parts[1]!) as BufferSource },
      await importKey(key),
      fromBase64(parts[2]!) as BufferSource,
    );
  } catch {
    throw new Error("Не удалось расшифровать ключ провайдера");
  }
  return new TextDecoder().decode(plain);
}

/** Маска для кабинета: `••••` + последние 4 символа токена. */
export function maskApiKey(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return tail.length === 4 ? `••••${tail}` : "••••";
}
