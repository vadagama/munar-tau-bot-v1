import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Alert, Button, Card, ConfigProvider, Space, Typography, theme, type FormInstance } from "antd";
import { DrawerActionContext } from "./card-drawer";

/** Форма подзадачи в текущей шторке; поля и отправка остаются у владельца. */
export function ActionPanel(props: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  full?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onOk?: () => void;
  okText?: string;
  okIcon?: ReactNode;
  hasUnsavedChanges?: () => boolean;
  form?: FormInstance;
  children: ReactNode;
}) {
  const { token } = theme.useToken();
  const context = useContext(DrawerActionContext);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const initialValues = useRef("");
  useEffect(() => {
    if (props.open && props.form) initialValues.current = JSON.stringify(props.form.getFieldsValue(true));
  }, [props.open, props.form]);
  const [discard, setDiscard] = useState(false);
  const cancel = () => {
    if (latest.current.busy) return;
    const dirty = latest.current.hasUnsavedChanges?.() || (latest.current.form &&
      JSON.stringify(latest.current.form.getFieldsValue(true)) !== initialValues.current);
    if (dirty) setDiscard(true);
    else latest.current.onCancel();
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const setEditor = context?.setEditor;
  useLayoutEffect(() => {
    if (!props.open) return;
    const opener = document.activeElement as HTMLElement | null;
    const scroll = opener?.closest(".ant-drawer-body");
    const position = scroll?.scrollTop ?? 0;
    setEditor?.({ id, full: !!props.full, cancel: () => cancelRef.current(), busy: () => !!latest.current.busy });
    return () => {
      setEditor?.(null);
      setDiscard(false);
      requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
        if (scroll?.isConnected) scroll.scrollTop = position;
      });
    };
  }, [props.open, props.full, id, setEditor]);
  const host = context?.host;
  useLayoutEffect(() => {
    if (!props.open) return;
    root.current?.focus({ preventScroll: true });
    const scroll = root.current?.closest(".ant-drawer-body");
    if (scroll) scroll.scrollTop = 0;
  }, [props.open, host]);
  if (!props.open) return null;
  const panel = <ConfigProvider componentDisabled={!!props.busy}>
    <div role="region" className="card-action-panel" ref={root} tabIndex={-1} aria-label={typeof props.title === "string" ? props.title : "Действие"}>
      <Card title={props.title} styles={{ title: { whiteSpace: "normal", overflowWrap: "anywhere" }, header: { paddingBlock: token.paddingXS, background: token.colorPrimaryBg, borderBottomColor: token.colorPrimaryBorder } }} style={{ marginBottom: token.margin, borderColor: token.colorPrimaryBorder, borderInlineStartWidth: token.lineWidthBold * 2 }}
        extra={<Button disabled={props.busy} onClick={cancel}>Отмена</Button>}>
        {props.description && <Typography.Paragraph role="note">{props.description}</Typography.Paragraph>}
        {props.error && <Alert role="alert" type="error" showIcon message={props.error} style={{ marginBottom: 16 }} />}
        {discard && <Alert type="warning" showIcon message="Выйти без сохранения введённых данных?"
          action={<Space wrap>
            <Button onClick={() => setDiscard(false)}>Продолжить редактирование</Button>
            <Button danger disabled={props.busy} onClick={() => {
              if (latest.current.busy) return;
              setDiscard(false); props.onCancel();
            }}>Выйти без сохранения</Button>
          </Space>} />}
        {props.children}
        {props.onOk && <Space style={{ position: "sticky", bottom: 0, paddingBlock: token.paddingSM, background: token.colorBgContainer, width: "100%" }}>
          <Button type="primary" icon={props.okIcon} loading={props.busy} onClick={props.onOk}>{props.okText ?? "Сохранить"}</Button>
        </Space>}
      </Card>
    </div>
  </ConfigProvider>;
  return host ? createPortal(panel, host) : panel;
}
