import { Button, Modal, Typography } from "antd";

/** Единое подтверждение закрытия формы: текст и действия не делят узкую строку. */
export function DiscardChangesDialog({ open, busy, onContinue, onDiscard }: {
  open: boolean; busy?: boolean; onContinue: () => void; onDiscard: () => void;
}) {
  return <Modal open={open} title="Выйти без сохранения?" onCancel={onContinue}
    maskClosable={false} closable={!busy} keyboard={!busy}
    footer={<div className="discard-changes-actions">
      <Button type="primary" autoFocus disabled={busy} onClick={onContinue}>Продолжить редактирование</Button>
      <Button danger disabled={busy} onClick={onDiscard}>Выйти без сохранения</Button>
    </div>}>
    <Typography.Paragraph>Введённые изменения будут потеряны. Сохранённые данные останутся без изменений.</Typography.Paragraph>
  </Modal>;
}
