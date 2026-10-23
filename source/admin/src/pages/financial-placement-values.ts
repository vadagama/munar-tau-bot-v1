import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
dayjs.extend(utc);
dayjs.extend(timezone);
export function financialPlacementValues(values: Record<string, unknown>, version: unknown) {
  const date = values.placed_at;
  if (!dayjs.isDayjs(date) || !date.isValid()) throw new Error("Укажите дату размещения");
  return { ...values, placed_at: dayjs.tz(date.format("YYYY-MM-DDTHH:mm:ss"), "Asia/Almaty").toISOString(), expected_version: version };
}
