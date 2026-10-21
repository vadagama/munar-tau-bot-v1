import { createElement, Fragment, useMemo, type ReactNode } from "react";

const FORMATTING: Record<string, string> = {
  b: "strong", strong: "strong", i: "em", em: "em", u: "u", ins: "u",
  s: "s", strike: "s", del: "s", code: "code", pre: "pre", blockquote: "blockquote",
};
const HIDDEN = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "img"]);

function safeHref(value: string | null): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (["http:", "https:", "tg:"].includes(url.protocol)) return value;
  } catch { /* Относительные и некорректные адреса остаются обычным текстом. */ }
}

function renderNode(node: Node, key: number, depth = 0, onBotLink?: (href: string) => boolean): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (HIDDEN.has(tag)) return null;
  if (depth >= 64) return element.textContent;
  const children = Array.from(element.childNodes, (child, i) => renderNode(child, i, depth + 1, onBotLink));
  if (tag === "a") {
    const href = safeHref(element.getAttribute("href"));
    return href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" onClick={event => { if (onBotLink?.(href)) event.preventDefault(); }}>{children}</a>
      : <Fragment key={key}>{children}</Fragment>;
  }
  if (tag === "tg-spoiler") {
    return <details key={key}><summary>Скрытый текст</summary>{children}</details>;
  }
  const formatting = Object.hasOwn(FORMATTING, tag) ? FORMATTING[tag] : undefined;
  if (!formatting) return <Fragment key={key}>{children}</Fragment>;
  return createElement(formatting, {
    key,
    ...(tag === "pre" ? { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } } : {}),
  }, children);
}

/** Разметка Telegram превращается в разрешённые React-элементы, без вставки HTML. */
export function TelegramText({ text, onBotLink }: { text: string; onBotLink?: (href: string) => boolean }) {
  return useMemo(() => {
    // XML-парсер не создаёт HTML-элементы и не загружает ресурсы из сообщения.
    // Поддерживаемые Telegram-теги и экранированные значения корректны как XML.
    const parsed = new DOMParser().parseFromString(`<message>${text}</message>`, "application/xml");
    if (parsed.querySelector("parsererror")) return <>{text}</>;
    return <>{Array.from(parsed.documentElement.childNodes, (node, i) => renderNode(node, i, 0, onBotLink))}</>;
  }, [text, onBotLink]);
}
