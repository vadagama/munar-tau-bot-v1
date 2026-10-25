import { DiscardChangesDialog } from "../components/discard-changes-dialog";
import { PageControlsContext } from "../components/page-controls";
import { createContext, useEffect, useState, type ReactNode } from "react";
import { Button, ConfigProvider, Drawer, Space } from "antd";

import { useMobile } from "../lib/use-mobile";
import { MobileActionContext } from "../components/mobile-action-context";
import { ArrowLeftOutlined } from "@ant-design/icons";

export const CARD_DRAWER_WIDTH = "min(960px, 100vw)";
type Editor = { id: string; full: boolean; cancel: () => void; busy: () => boolean };
export const DrawerActionContext = createContext<{
  host: HTMLDivElement | null;
  editor: Editor | null;
  setEditor: (editor: Editor | null) => void;
} | null>(null);

/** Одна поверхность: карточка и её формы используют один Drawer. */
export function CardDrawer(props: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  onEditingChange?: (editing: boolean) => void;
  hasUnsavedChanges?: () => boolean;
  footer?: ReactNode | ((close: () => void) => ReactNode);
  children: ReactNode;
}) {
  const mobile = useMobile();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  useEffect(() => { props.onEditingChange?.(!!editor); }, [editor, props.onEditingChange]);
  const [discard, setDiscard] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const close = () => {
    if (props.closeDisabled || editor?.busy()) return;
    if (editor) return editor.cancel();
    if (props.hasUnsavedChanges?.()) setDiscard(true);
    else props.onClose();
  };
  return (
    <Drawer rootClassName="cabinet-card-drawer" closeIcon={mobile ? <ArrowLeftOutlined aria-label="Назад" /> : undefined} open={props.open} title={props.title} width={mobile || expanded ? "100vw" : CARD_DRAWER_WIDTH}
      onClose={close} keyboard={!props.closeDisabled} maskClosable={!props.closeDisabled}
      afterOpenChange={(open) => { if (!open) setDiscard(false); }}
      extra={editor || mobile ? null : <Space><Button aria-label={expanded ? "Свернуть карточку" : "Развернуть карточку"} onClick={() => setExpanded(!expanded)}>{expanded ? "Свернуть" : "Развернуть"}</Button><Button disabled={props.closeDisabled} onClick={close}>Закрыть карточку</Button></Space>} footer={mobile ? <>
        {mobile && <div className="mobile-card-action" ref={setActionHost} />}
        {typeof props.footer === "function" ? props.footer(close) : props.footer}
      </> : typeof props.footer === "function" ? props.footer(close) : props.footer}>
      <PageControlsContext.Provider value={null}>
      <MobileActionContext.Provider value={mobile && !editor ? actionHost : null}>
      <DrawerActionContext.Provider value={{ host, editor, setEditor }}>
        <DiscardChangesDialog open={discard} busy={props.closeDisabled || editor?.busy()}
          onContinue={() => setDiscard(false)} onDiscard={() => {
            if (!props.closeDisabled && !editor?.busy()) { setDiscard(false); props.onClose(); }
          }} />
        <div ref={setHost} />
        <div hidden={!!editor?.full}>
          <ConfigProvider componentDisabled={!!editor || !!props.closeDisabled}>{props.children}</ConfigProvider>
        </div>
      </DrawerActionContext.Provider>
      </MobileActionContext.Provider>
      </PageControlsContext.Provider>
    </Drawer>
  );
}
