import { Button, DatePicker, Input, Space } from "antd";
import type { DatePickerProps, InputProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";

const presets = [
  { label: "час", amount: 1, unit: "hour" },
  { label: "2 часа", amount: 2, unit: "hour" },
  { label: "3 часа", amount: 3, unit: "hour" },
  { label: "6 часов", amount: 6, unit: "hour" },
  { label: "12 часов", amount: 12, unit: "hour" },
  { label: "сутки", amount: 24, unit: "hour" },
  { label: "неделя", amount: 168, unit: "hour" },
  { label: "месяц", amount: 1, unit: "month" },
] as const;

function DeadlinePresets({ onSelect, disabled }: {
  onSelect: (date: Dayjs) => void;
  disabled?: boolean;
}) {
  return (
    <Space
      wrap
      size={[8, 8]}
      style={{ marginTop: 8 }}
      role="group"
      aria-label="Шаблоны срока"
    >
      {presets.map(({ label, amount, unit }) => (
        <Button
          key={label}
          size="small"
          htmlType="button"
          disabled={disabled}
          onClick={() => onSelect(dayjs().add(amount, unit))}
        >
          {label}
        </Button>
      ))}
    </Space>
  );
}

type DeadlineInputProps = Omit<InputProps, "type" | "value" | "onChange"> & {
  value?: string;
  onChange?: (value: string) => void;
};

/** Emits ordinary form changes so validation and dirty tracking also run for presets. */
export function DeadlineInput({
  value, onChange, disabled, ...props
}: DeadlineInputProps) {
  return (
    <div>
      <Input
        {...props}
        type="datetime-local"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <DeadlinePresets
        disabled={disabled}
        onSelect={(date) => onChange?.(date.format("YYYY-MM-DDTHH:mm"))}
      />
    </div>
  );
}

export function DeadlineDatePicker({ onChange, disabled, ...props }: DatePickerProps) {
  return (
    <div>
      <DatePicker {...props} onChange={onChange} disabled={disabled} />
      <DeadlinePresets
        disabled={disabled === true}
        onSelect={(date) => onChange?.(date, date.format("DD.MM.YYYY HH:mm"))}
      />
    </div>
  );
}
