import { Result } from "antd";

// VS-0: рабочая область пуста. Разделы (обращения, задания, аварии, публикации)
// приходят срезами VS-2+ по docs/hld.md раздел 27.
export function HomePage() {
  return (
    <Result
      status="info"
      title="Кабинет ОСИ"
      subTitle="Рабочие разделы появятся со следующими срезами (VS-2+). Сейчас выполнен только каркас VS-0."
    />
  );
}
