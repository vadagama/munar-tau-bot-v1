import { Input, theme, type InputProps } from "antd";

/** Подпись остаётся над датой при переносе строки фильтров. */
export function FilterDate({ label, style, ...props }: InputProps & { label: string }) {
  const { token } = theme.useToken();
  return <label className="list-filter-date">{label}
    <Input type="date" {...props} style={{ height: token.controlHeight, ...style }} />
  </label>;
}
