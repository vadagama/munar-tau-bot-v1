import { useState, Children, cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode, type ComponentProps } from "react";
import { Button, Space, Tag, Typography, theme } from "antd";
import { DetailSection } from "./detail-section";
import type { ProcessGuidance } from "./process-guidance";
import "./process-card.css";

export function ProcessOverview({ guidance, state, due, dueLabel = "Срок", participant, children }: {
 guidance: ProcessGuidance; state?: string; due?: unknown; dueLabel?: string; participant?: string | null; children?: ReactNode;
}) {
 const { token } = theme.useToken();
 const date = due ? new Date(String(due)) : null;
 return <section aria-label="Сейчас по процессу" className="process-overview" style={{borderColor:token.colorBorderSecondary,borderInlineStartColor:token.colorPrimary,background:token.colorBgContainer}}>
  <div className="process-overview__heading"><Typography.Title level={3}>Сейчас по процессу</Typography.Title>{state && <Tag>{state}</Tag>}</div>
  <Typography.Text strong>{guidance.title}</Typography.Text>
  <Typography.Paragraph>{guidance.description}</Typography.Paragraph>
  {participant && <Typography.Text>Ответственный: {participant}</Typography.Text>}
  <Space wrap size="large"><Typography.Text type="secondary">Участник следующего шага: {guidance.waitingFor}</Typography.Text>
   {date && !Number.isNaN(date.getTime()) && <Typography.Text>{dueLabel}: {date.toLocaleString("ru-RU", {timeZone:"Asia/Almaty"})} (Алматы)</Typography.Text>}
  </Space>
  {children}
 </section>;
}

// Разворачиваем только фрагменты; обработчики и disabled исходных кнопок сохраняются.
function buttons(children: ReactNode): ReactElement<ComponentProps<typeof Button>>[] {
 return Children.toArray(children).flatMap(child => {
  if (!isValidElement(child)) return [];
  if (child.type === Fragment) return buttons((child.props as {children: ReactNode}).children);
  return child.type === Button ? [child as ReactElement<ComponentProps<typeof Button>>] : [];
 });
}
export function ProcessActions({ primary, secondary = [], showAll = false, children }: {primary?: string; secondary?: string[]; showAll?: boolean; children: ReactNode}) {
 const [more, setMore] = useState(false);
 const all = buttons(children);
 // Children.toArray экранирует React key; сравниваем исходный суффикс ключа.
 const keyOf = (button: ReactElement) => String(button.key).split("$").at(-1);
 const main = all.find(button => keyOf(button) === primary);
 const frequent = all.filter(button => button !== main && (showAll || secondary.includes(keyOf(button) ?? "")));
 const other = all.filter(button => button !== main && !frequent.includes(button));
 if (!all.length) return null;
 return <div className="process-actions">
  <Space wrap>{main && cloneElement(main, {type:"primary"})}{frequent.map(button => cloneElement(button, {type:"default"}))}</Space>
  {!!other.length && <div className="process-actions__other"><Button type="text" aria-expanded={more} onClick={() => setMore(!more)}>Другие действия</Button><div hidden={!more}><Space wrap>{other.map(button => cloneElement(button, {type:"default"}))}</Space></div></div>}
 </div>;
}
export function ProcessHistory({title = "История", children}: {title?: string; children: ReactNode}) {
 return <DetailSection title={title}><details><summary>Показать историю</summary>{children}</details></DetailSection>;
}
