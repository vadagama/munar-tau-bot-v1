import type { ReactNode } from "react";
import { Button, Drawer } from "antd";

// Единая ширина карточки, открывающейся справа от списка. Как на «Шаблонах
// сообщений», только уже: карточке не нужен двухпанельный редактор.
export const CARD_DRAWER_WIDTH = "min(960px, 100vw)";

/** Карточка объекта (обращение, задание, инцидент, публикация) — единый Drawer справа: список остаётся на месте, карточка не сдвигает его вниз. */
export function CardDrawer(props: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Drawer
      open={props.open}
      title={props.title}
      width={CARD_DRAWER_WIDTH}
      onClose={props.onClose}
      extra={
        <Button disabled={props.closeDisabled} onClick={props.onClose}>
          Закрыть карточку
        </Button>
      }
    >
      {props.children}
    </Drawer>
  );
}
