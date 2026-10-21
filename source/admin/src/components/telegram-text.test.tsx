import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TelegramText } from "./telegram-text";
afterEach(cleanup);
it("форматирует номер обращения и сохраняет текст и переносы ответа", () => {
  const { container } = render(<TelegramText text={'<b>З-26-00011</b> — зарегистрировано.\nДействия: /visits НОМЕР'} />);
  expect(screen.getByText("З-26-00011").tagName).toBe("STRONG");
  expect(container.textContent).toBe("З-26-00011 — зарегистрировано.\nДействия: /visits НОМЕР");
});
it("поддерживает вложенное выделение, код и цитату", () => {
  const { container } = render(<TelegramText text={'<i><u>Курсив</u></i> <s>Отменено</s><blockquote>Цитата</blockquote><pre><code>1 &lt; 2 &amp; 3</code></pre>'} />);
  expect(container.querySelector("em u")).toHaveTextContent("Курсив");
  expect(container.querySelector("s")).toHaveTextContent("Отменено");
  expect(container.querySelector("blockquote")).toHaveTextContent("Цитата");
  expect(container.querySelector("pre code")).toHaveTextContent("1 < 2 & 3");
});
it("не превращает экранированные пользовательские теги в разметку", () => {
  const text = '<b>Имя: &lt;img src=x onerror=alert(1)&gt; &amp; &quot;текст&quot;</b>';
  const { container } = render(<TelegramText text={text} />);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toBe('Имя: <img src=x onerror=alert(1)> & "текст"');
});
it("отбрасывает активные элементы и атрибуты и запрещает опасные ссылки", () => {
  const { container } = render(<TelegramText text={'<b onclick="alert(1)">Номер</b><script>alert(1)</script><img src="https://example.org/pixel"/><a href="java&#115;cript:alert(1)">Опасная ссылка</a><a href="data:text/html,bad">Данные</a>'} />);
  expect(container.querySelector("script, img, [onclick], [src]")).toBeNull();
  expect(container.querySelector("a")).toBeNull();
  expect(container.textContent).toBe("НомерОпасная ссылкаДанные");
});
it("разрешает только абсолютные http(s) и Telegram-ссылки", () => {
  render(<TelegramText text={'<a href="https://example.org/?a=1&amp;b=2">Сайт</a> <a href="tg://user?id=1">Telegram</a> <a href="//example.org">Относительная</a>'} />);
  expect(screen.getByRole("link", { name: "Сайт" })).toHaveAttribute("href", "https://example.org/?a=1&b=2");
  expect(screen.getByRole("link", { name: "Сайт" })).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.getByRole("link", { name: "Telegram" })).toHaveAttribute("href", "tg://user?id=1");
  expect(screen.queryByRole("link", { name: "Относительная" })).toBeNull();
});
it("при некорректной разметке безопасно сохраняет исходный текст", () => {
  const text = '<b>Не закрыт & текст';
  const { container } = render(<TelegramText text={text} />);
  expect(container.textContent).toBe(text);
  expect(container.querySelector("b, strong")).toBeNull();
});

it("не принимает имена свойств прототипа за разрешённые теги", () => {
  const { container } = render(<TelegramText text={'<constructor>Текст</constructor><toString>Ещё текст</toString>'} />);
  expect(container.textContent).toBe("ТекстЕщё текст");
});

it("routes own bot links internally while preserving ordinary links", () => {
  const open = vi.fn().mockReturnValue(true);
  render(<TelegramText text={'<a href="https://t.me/munar_tau_worker_bot?start=sreq_00000000-0000-4000-8000-000000000001">№123</a>'} onBotLink={open} />);
  fireEvent.click(screen.getByRole('link',{name:'№123'}));
  expect(open).toHaveBeenCalledWith('https://t.me/munar_tau_worker_bot?start=sreq_00000000-0000-4000-8000-000000000001');
});
