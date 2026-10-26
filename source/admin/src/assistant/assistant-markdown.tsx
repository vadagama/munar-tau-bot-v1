// Ответ ассистента — Markdown-подмножество React-нодами (план S1.2, решение
// 25.10.2026: модель не генерирует HTML). Перенос прототипа
// prototypes/dashboard-library (assistant-rich-text.tsx) ~1:1: никакого
// dangerouslySetInnerHTML, ссылки — только из серверных sources по allow-list
// путей, ответ обрезается по длине. HTML в тексте модели остаётся текстом.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface AssistantSource { title: string; href: string; total?: number; ref?: string }

function inline(text: string, sources: AssistantSource[]): ReactNode[] {
  return text.split(/(!?\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const source = sources.find(s => s.ref === link[2] || s.href === link[2]);
      if (source && /^\/(requests|tasks|incidents|registrations|registry\/(buildings|premises))(\?|$)/.test(source.href) && !/[\\\x00-\x20]/.test(source.href)) return <Link key={i} to={source.href}>{source.title}</Link>;
      return link[1];
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{inline(part.slice(2, -2), sources)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
const separator = (line: string) => line.includes("|") && cells(line).every(c => /^:?-{3,}:?$/.test(c));
const listItem = (line: string) => /^\s*(?:[-*+] |\d+[.)] )/.test(line);

export function AssistantMarkdown({ text, sources = [] }: { text: string; sources?: AssistantSource[] }) {
  const format = (value: string) => inline(value, sources);
  const lines = text.slice(0, 24000).replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const key = i;
    if (line.startsWith("```")) {
      const code: string[] = []; i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++; blocks.push(<pre key={key}>{code.join("\n")}</pre>); continue;
    }
    if (i + 1 < lines.length && line.includes("|") && separator(lines[i + 1]!)) {
      const headers = cells(line), rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) rows.push(cells(lines[i++]!));
      if (headers.length > 8 || rows.length > 40 || cells(lines[key + 1]!).length !== headers.length || rows.some(r => r.length !== headers.length)) {
        blocks.push(<pre key={key}>{lines.slice(key, i).join("\n")}</pre>); continue;
      }
      blocks.push(<div className="assistant-table-scroll" tabIndex={0} role="region" aria-label="Таблица ответа" key={key}><table><thead><tr>{headers.map((h,j) => <th scope="col" key={j}>{format(h)}</th>)}</tr></thead><tbody>{rows.map((r,j) => <tr key={j}>{headers.map((_,k) => <td key={k}>{format(r[k] ?? "")}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    if (/^#{1,6} /.test(line)) { blocks.push(<h4 key={key}>{format(line.replace(/^#{1,6} /, ""))}</h4>); i++; continue; }
    if (listItem(line)) {
      const ordered = /^\s*\d/.test(line), entries: ReactNode[] = [];
      while (i < lines.length && listItem(lines[i]!) && /^\s*\d/.test(lines[i]!) === ordered) {
        entries.push(<li key={i}>{format(lines[i++]!.replace(/^\s*(?:[-*+] |\d+[.)] )/, ""))}</li>);
      }
      blocks.push(ordered ? <ol key={key} start={Number.parseInt(line.trim(), 10)}>{entries}</ol> : <ul key={key}>{entries}</ul>); continue;
    }
    if (line.startsWith("> ")) { blocks.push(<blockquote key={key}>{format(line.slice(2))}</blockquote>); i++; continue; }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i]!.trim() && !listItem(lines[i]!) && !/^(#{1,6} |>|```)/.test(lines[i]!) && !(i + 1 < lines.length && separator(lines[i+1]!))) paragraph.push(lines[i++]!);
    blocks.push(<p key={key}>{format(paragraph.join("\n"))}</p>);
  }
  return <div className="assistant-rich-text">{blocks}</div>;
}
