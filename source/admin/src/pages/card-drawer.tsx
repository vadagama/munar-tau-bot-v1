import { createContext, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, ConfigProvider, Drawer, Space } from "antd";
import { useNarrow } from "../lib/use-narrow";

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
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const narrow = useNarrow();
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
    <Drawer open={props.open} title={props.title} width={expanded ? "100vw" : CARD_DRAWER_WIDTH}
      onClose={close} keyboard={!props.closeDisabled} maskClosable={!props.closeDisabled}
      afterOpenChange={(open) => { if (!open) setDiscard(false); }}
      extra={editor ? null : <Space>{!narrow && <Button aria-label={expanded ? "Свернуть карточку" : "Развернуть карточку"} onClick={() => setExpanded(!expanded)}>{expanded ? "Свернуть" : "Развернуть"}</Button>}<Button disabled={props.closeDisabled} onClick={close}>Закрыть карточку</Button></Space>} footer={typeof props.footer === "function" ? props.footer(close) : props.footer}>
      <DrawerActionContext.Provider value={{ host, editor, setEditor }}>
        {discard && <Alert type="warning" showIcon message="Остались несохранённые изменения"
          action={<Space wrap>
            <Button onClick={() => setDiscard(false)}>Продолжить редактирование</Button>
            <Button danger disabled={props.closeDisabled || editor?.busy()} onClick={() => {
              if (props.closeDisabled || editor?.busy()) return;
              setDiscard(false); props.onClose();
            }}>Выйти без сохранения</Button>
          </Space>} />}
        <div ref={setHost} />
        <div hidden={!!editor?.full}>
          <ConfigProvider componentDisabled={!!editor || !!props.closeDisabled}>{props.children}</ConfigProvider>
        </div>
      </DrawerActionContext.Provider>
    </Drawer>
  );
}
