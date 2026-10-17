/** Нумерованные части сохраняют весь текст, даже если доставка повторяется или меняет порядок. */
export function notificationParts(message: string): string[] {
  if (message.length <= 4096) return [message];
  const parts: string[] = [];
  let part = "";
  for (const character of message) {
    if (part.length + character.length > 4000) {
      parts.push(part);
      part = "";
    }
    part += character;
  }
  if (part) parts.push(part);
  return parts.map((text, index) => `[${index + 1}/${parts.length}]\n${text}`);
}

