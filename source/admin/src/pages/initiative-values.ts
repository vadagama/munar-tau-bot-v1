import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
dayjs.extend(utc);dayjs.extend(timezone);
/** Поля подписаны «Алматы»: ручной календарный ввод не наследует зону браузера. */
export function initiativeDeadline(value:unknown):string {
 if(!dayjs.isDayjs(value)||!value.isValid())throw new Error("Укажите корректный срок в Алматы");
 return dayjs.tz(value.format("YYYY-MM-DDTHH:mm:ss"),"Asia/Almaty").toISOString();
}
