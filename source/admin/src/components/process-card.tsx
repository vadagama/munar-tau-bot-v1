import { Children, cloneElement, useContext, Fragment, isValidElement, type ReactElement, type ReactNode, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { MobileActionContext } from "./mobile-action-context";
import { Button, Space, Tag, Typography, theme } from "antd";
import { DetailSection } from "./detail-section";
import type { ProcessGuidance } from "./process-guidance";
import { formatDateTime } from "../lib/format-date";
import "./process-card.css";

export function ProcessOverview({ guidance, state, due, dueLabel = "Срок", participant, participantLabel = "Ответственный", children }: {
 guidance: ProcessGuidance; state?: string; due?: unknown; dueLabel?: string; participant?: string | null; participantLabel?: string; children?: ReactNode;
}) {
 const { token } = theme.useToken();
 const date = due ? new Date(String(due)) : null;
 return <section aria-label="Сейчас по процессу" className="process-overview" style={{borderColor:token.colorBorderSecondary,background:token.colorBgContainer}}>
  <div className="process-overview__heading"><Typography.Title level={3}>Сейчас по процессу</Typography.Title>{state && <Tag>{state}</Tag>}</div>
  <Typography.Text strong>{guidance.title}</Typography.Text>
  <Typography.Paragraph>{guidance.description}</Typography.Paragraph>
  {participant && <Typography.Text>{participantLabel}: {participant}</Typography.Text>}
  <Space wrap size="large"><Typography.Text type="secondary">Кто действует дальше: {guidance.waitingFor}</Typography.Text>
   {date && !Number.isNaN(date.getTime()) && <Typography.Text>{dueLabel}: {formatDateTime(date)} (Алматы)</Typography.Text>}
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
export function ProcessActions({ primary, children }: {primary?: string; children: ReactNode}) {
 const mobileActionHost = useContext(MobileActionContext);
 const all = buttons(children);
 // Children.toArray экранирует React key; сравниваем исходный суффикс ключа.
 const keyOf = (button: ReactElement) => String(button.key).split("$").at(-1);
 const main = all.find(button => keyOf(button) === primary);
 const remaining = all.filter(button => button !== main);
 if (!all.length) return null;
 return <div className="process-actions">
  <Space wrap>{main && (mobileActionHost ? createPortal(cloneElement(main, {type:"primary", block:true}), mobileActionHost) : cloneElement(main, {type:"primary"}))}{remaining.map(button => cloneElement(button, {type:"default"}))}</Space>
 </div>;
}
export function ProcessHistory({title = "История", children}: {title?: string; children: ReactNode}) {
 return <DetailSection title={title}><details><summary>Показать историю</summary>{children}</details></DetailSection>;
}
